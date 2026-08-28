import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PasswordResetRateLimitError,
  requestPasswordReset,
} from "../src/passwordReset.js";

const config = {
  clientId: "client-id",
  connection: "Username-Password-Authentication",
  domain: "tenant.auth0.com",
};

describe("requestPasswordReset", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests an Auth0 reset email without exposing credentials", async () => {
    const fetch = vi.fn(async () => new Response("We've just sent you an email", {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetch);

    await requestPasswordReset(config, " reefer@example.com ");

    expect(fetch).toHaveBeenCalledWith(
      "https://tenant.auth0.com/dbconnections/change_password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "client-id",
          connection: "Username-Password-Authentication",
          email: "reefer@example.com",
        }),
      }),
    );
  });

  it("uses the same successful outcome when Auth0 reports no user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    await expect(
      requestPasswordReset(config, "unknown@example.com"),
    ).resolves.toBeUndefined();
  });

  it("reports rate limiting without exposing the Auth0 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));

    await expect(
      requestPasswordReset(config, "reefer@example.com"),
    ).rejects.toBeInstanceOf(PasswordResetRateLimitError);
  });
});
