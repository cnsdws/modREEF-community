import { describe, expect, it } from "vitest";

import { normalizeOidcIssuer } from "../src/auth.js";

describe("OIDC issuer normalization", () => {
  it("preserves the trailing slash used by Auth0 token issuers", () => {
    expect(normalizeOidcIssuer("https://modreef-prod.us.auth0.com/")).toBe(
      "https://modreef-prod.us.auth0.com/",
    );
  });

  it("adds exactly one trailing slash when configuration omits it", () => {
    expect(normalizeOidcIssuer("https://modreef-prod.us.auth0.com")).toBe(
      "https://modreef-prod.us.auth0.com/",
    );
    expect(normalizeOidcIssuer("https://modreef-prod.us.auth0.com///")).toBe(
      "https://modreef-prod.us.auth0.com/",
    );
  });
});
