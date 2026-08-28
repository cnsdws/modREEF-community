import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import { describe, expect, it } from "vitest";

import {
  handleEquipmentRequest,
} from "../src/equipment-api.js";
import {
  handleAutomationRequest,
} from "../src/automation-api.js";

function createResponse() {
  let statusCode: number | undefined;
  let body = "";

  const response = {
    writeHead(code: number) {
      statusCode = code;
      return response;
    },
    end(value?: string) {
      body = value ?? "";
      return response;
    },
  } as unknown as ServerResponse;

  return {
    response,
    statusCode: () => statusCode,
    body: () => body,
  };
}

describe("equipment API authorization", () => {
  it("rejects an equipment request without a paired-app token", async () => {
    const request = {
      method: "GET",
      url: "/equipment",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleEquipmentRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects schedule changes without a paired-app token", async () => {
    const request = {
      method: "PUT",
      url: "/equipment/return-pump/schedule",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleEquipmentRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects program-type changes without a paired-app token", async () => {
    const request = {
      method: "PUT",
      url: "/equipment/return-pump/program-type",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleEquipmentRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects advanced-program changes without a paired-app token", async () => {
    const request = {
      method: "PUT",
      url: "/equipment/return-pump/advanced-program",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();
    expect(await handleEquipmentRequest(request, result.response)).toBe(true);
    expect(result.statusCode()).toBe(401);
  });

  it("does not intercept unrelated routes", async () => {
    const request = {
      method: "GET",
      url: "/health",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleEquipmentRequest(request, result.response),
    ).toBe(false);
    expect(result.statusCode()).toBeUndefined();
  });
});

describe("automation API authorization", () => {
  it("rejects Feed Mode without a paired-app token", async () => {
    const request = {
      method: "GET",
      url: "/modes/feed",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleAutomationRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects Water Change without a paired-app token", async () => {
    const request = {
      method: "POST",
      url: "/routines/water-change",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleAutomationRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects custom routine CRUD without a paired-app token", async () => {
    const request = {
      method: "POST",
      url: "/routines/custom",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleAutomationRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("does not intercept unrelated routes", async () => {
    const request = {
      method: "GET",
      url: "/health",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleAutomationRequest(request, result.response),
    ).toBe(false);
    expect(result.statusCode()).toBeUndefined();
  });
});
