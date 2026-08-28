import { describe, expect, it } from "vitest";

import { qualificationForIdentity } from "../src/qualificationRegistry.js";

describe("qualificationForIdentity", () => {
  it("returns the GHome WP12 profile", () => {
    const qualification = qualificationForIdentity({
      manufacturer: "GHome",
      model: "WP12",
      confidence: 1,
    });

    expect(qualification?.status).toBe("verified");
  });

  it("returns null for unknown identities", () => {
    expect(
      qualificationForIdentity({
        manufacturer: "Unknown",
        model: "Unknown",
        confidence: 0,
      }),
    ).toBeNull();
  });
});
