import { describe, expect, it } from "vitest";

import { validPublishToken, validReleaseMetadata } from "../src/edge-release-store.js";

describe("Edge release publication validation", () => {
  it("compares publication tokens without exposing their contents", () => {
    expect(validPublishToken("same-secret", "same-secret")).toBe(true);
    expect(validPublishToken("wrong-secret", "same-secret")).toBe(false);
    expect(validPublishToken(undefined, "same-secret")).toBe(false);
    expect(validPublishToken("same-secret", undefined)).toBe(false);
  });

  it("requires immutable SHA-256 and Git commit metadata", () => {
    expect(validReleaseMetadata("a".repeat(64), "b".repeat(40))).toBe(true);
    expect(validReleaseMetadata("A".repeat(64), "b".repeat(40))).toBe(false);
    expect(validReleaseMetadata("a".repeat(63), "b".repeat(40))).toBe(false);
    expect(validReleaseMetadata("a".repeat(64), "main")).toBe(false);
  });
});
