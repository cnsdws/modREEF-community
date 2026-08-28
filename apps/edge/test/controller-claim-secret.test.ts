import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { controllerClaimSecretMatches } from "../src/controller-claim-secret.js";

describe("controller QR claim secret", () => {
  const secret = "s".repeat(43);
  const hash = createHash("sha256").update(secret).digest("hex");

  it("accepts the secret printed for an enrolled controller", () => {
    expect(controllerClaimSecretMatches(hash, secret)).toBe(true);
  });

  it("rejects missing, malformed, and incorrect secrets", () => {
    expect(controllerClaimSecretMatches(hash, undefined)).toBe(false);
    expect(controllerClaimSecretMatches(hash, "short")).toBe(false);
    expect(controllerClaimSecretMatches(hash, "x".repeat(43))).toBe(false);
  });

  it("preserves LAN onboarding for an unenrolled development controller", () => {
    expect(controllerClaimSecretMatches(undefined, undefined)).toBe(true);
  });
});
