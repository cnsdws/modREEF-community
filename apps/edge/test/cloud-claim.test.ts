import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { handleOnboardingRequest } from "../src/onboarding-api.js";

function request(
  body: unknown,
  url = "/onboarding/cloud-claim",
  authorization?: string,
): IncomingMessage {
  const stream = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  stream.method = "POST";
  stream.url = url;
  stream.headers = authorization ? { authorization: `Bearer ${authorization}` } : {};
  return stream;
}

function responseCapture() {
  let status: number | undefined;
  let body = "";
  const response = {
    writeHead(code: number) { status = code; return response; },
    end(value?: string) { body = value ?? ""; return response; },
  } as unknown as ServerResponse;
  return { response, status: () => status, body: () => JSON.parse(body) as unknown };
}

describe("Reef Controller cloud claim", () => {
  it("passes a valid one-time registration to the claim handler", async () => {
    const claim = vi.fn(async () => undefined);
    const result = responseCapture();
    const credentials = {
      edgeId: "edge-2",
      aquariumId: "aquarium-1",
      token: "a".repeat(43),
      claimSecret: "s".repeat(43),
    };

    expect(await handleOnboardingRequest(
      request(credentials), result.response, claim,
    )).toBe(true);
    expect(result.status()).toBe(200);
    expect(claim).toHaveBeenCalledWith({
      cloudUrl: "https://api.modreef.net",
      edgeId: credentials.edgeId,
      aquariumId: credentials.aquariumId,
      token: credentials.token,
    }, credentials.claimSecret);
    expect(result.body()).toMatchObject({
      claimed: true,
      edgeId: credentials.edgeId,
      authorization: {
        token: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
  });

  it("refuses cloud claim when the controller is already claimed", async () => {
    const result = responseCapture();
    expect(await handleOnboardingRequest(
      request({ edgeId: "edge-2", aquariumId: "aquarium-1", token: "a".repeat(43) }),
      result.response,
    )).toBe(true);
    expect(result.status()).toBe(409);
  });

  it("rejects a malformed controller setup secret before claiming", async () => {
    const claim = vi.fn(async () => undefined);
    const result = responseCapture();
    expect(await handleOnboardingRequest(
      request({
        edgeId: "edge-2",
        aquariumId: "aquarium-1",
        token: "a".repeat(43),
        claimSecret: "not-a-valid-secret",
      }),
      result.response,
      claim,
    )).toBe(true);
    expect(result.status()).toBe(400);
    expect(claim).not.toHaveBeenCalled();
  });

  it("exchanges a cloud-approved grant for durable local authorization", async () => {
    const result = responseCapture();
    const authorize = vi.fn(() => true);
    expect(await handleOnboardingRequest(
      request({ grant: "signed-grant" }, "/onboarding/cloud-authorization"),
      result.response,
      undefined,
      authorize,
    )).toBe(true);
    expect(authorize).toHaveBeenCalledWith("signed-grant");
    expect(result.status()).toBe(200);
    expect(result.body()).toMatchObject({
      authorization: { token: expect.any(String), expiresAt: expect.any(String) },
    });
  });

  it("requires local authorization before unclaiming an empty controller", async () => {
    const unauthorized = responseCapture();
    expect(await handleOnboardingRequest(
      request({}, "/onboarding/cloud-unclaim"),
      unauthorized.response,
      undefined,
      undefined,
      vi.fn(async () => undefined),
    )).toBe(true);
    expect(unauthorized.status()).toBe(401);

    const authorization = responseCapture();
    await handleOnboardingRequest(
      request({ grant: "signed-grant" }, "/onboarding/cloud-authorization"),
      authorization.response,
      undefined,
      () => true,
    );
    const token = (authorization.body() as { authorization: { token: string } }).authorization.token;
    const unclaim = vi.fn(async () => undefined);
    const result = responseCapture();
    expect(await handleOnboardingRequest(
      request({}, "/onboarding/cloud-unclaim", token),
      result.response,
      undefined,
      undefined,
      unclaim,
      () => ({ deviceIds: [], equipmentIds: [] }),
    )).toBe(true);
    expect(result.status()).toBe(200);
    expect(result.body()).toEqual({ unclaimed: true });
    expect(unclaim).toHaveBeenCalledOnce();
  });

  it("reports the devices and equipment blocking controller removal", async () => {
    const authorization = responseCapture();
    await handleOnboardingRequest(
      request({ grant: "another-grant" }, "/onboarding/cloud-authorization"),
      authorization.response,
      undefined,
      () => true,
    );
    const token = (authorization.body() as { authorization: { token: string } }).authorization.token;
    const unclaim = vi.fn(async () => undefined);
    const result = responseCapture();
    await handleOnboardingRequest(
      request({}, "/onboarding/cloud-unclaim", token),
      result.response,
      undefined,
      undefined,
      unclaim,
      () => ({ deviceIds: ["strip-1"], equipmentIds: ["outlet-1"] }),
    );
    expect(result.status()).toBe(409);
    expect(result.body()).toMatchObject({
      code: "CONTROLLER_HAS_DEVICES",
      deviceIds: ["strip-1"],
      equipmentIds: ["outlet-1"],
    });
    expect(unclaim).not.toHaveBeenCalled();
  });
});
