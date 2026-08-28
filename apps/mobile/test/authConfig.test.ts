import { describe, expect, it } from "vitest";

import { authConfig } from "../src/authConfig";

describe("Auth0 client configuration", () => {
  it("uses the SPA client for web", () => {
    expect(authConfig("web")).toMatchObject({
      audience: "https://api.modreef.net",
      clientId: "hechWmvgelkOfHIOYGfxsGYilYwqvR5t",
      databaseConnection: "Username-Password-Authentication",
      domain: "modreef-prod.us.auth0.com",
    });
  });

  it("uses the native client for installed applications", () => {
    expect(authConfig("ios").clientId).toBe(
      "GBBfPpP7bS3Ft1EcpLTUyA7JWyrmgkIU",
    );
    expect(authConfig("android").clientId).toBe(
      "GBBfPpP7bS3Ft1EcpLTUyA7JWyrmgkIU",
    );
  });
});
