import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyCloudLocalAuthorization } from "../src/cloud-local-authorization.js";

const config = {
  cloudUrl: "https://api.modreef.test",
  edgeId: "edge-1",
  aquariumId: "reef-1",
  token: "controller-secret",
};

function grant(overrides: Record<string, unknown> = {}) {
  const payload = Buffer.from(JSON.stringify({
    edgeId: config.edgeId,
    aquariumId: config.aquariumId,
    expiresAtMs: 61_000,
    nonce: "1234567890abcdef",
    ...overrides,
  })).toString("base64url");
  const secret = createHash("sha256").update(config.token).digest("hex");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

describe("cloud-authorized local administration", () => {
  it("accepts a current grant for this controller", () => {
    expect(verifyCloudLocalAuthorization(grant(), config, 1_000)).toMatchObject({
      edgeId: "edge-1",
      aquariumId: "reef-1",
    });
  });

  it("rejects expired and wrong-controller grants", () => {
    expect(verifyCloudLocalAuthorization(grant({ expiresAtMs: 999 }), config, 1_000)).toBeNull();
    expect(verifyCloudLocalAuthorization(grant({ edgeId: "edge-2" }), config, 1_000)).toBeNull();
  });
});
