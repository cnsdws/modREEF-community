import { describe, expect, it } from "vitest";
import {
  biometricBackgroundGraceMilliseconds,
  shouldLockAfterBackground,
} from "../src/biometricLock.js";

describe("biometric background lock", () => {
  it("locks after the five-minute grace period", () => {
    expect(shouldLockAfterBackground(1_000, 1_000 + biometricBackgroundGraceMilliseconds))
      .toBe(true);
  });

  it("does not lock for a brief interruption or without a background time", () => {
    expect(shouldLockAfterBackground(1_000, 1_000 + 60_000)).toBe(false);
    expect(shouldLockAfterBackground(null, Date.now())).toBe(false);
  });
});
