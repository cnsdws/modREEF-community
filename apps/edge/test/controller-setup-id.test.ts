import { describe, expect, it } from "vitest";

import { deriveControllerSetupId } from "../src/controller-setup-id.js";

describe("deriveControllerSetupId", () => {
  it("preserves a validated factory setup identifier", () => {
    expect(deriveControllerSetupId({
      factorySetupId: "ABC123",
      physicalSerial: "10000000502b7d72",
      fallbackIdentity: "machine",
    })).toBe("ABC123");
  });

  it("uses the Pi serial for an owner-imaged community controller", () => {
    expect(deriveControllerSetupId({
      physicalSerial: "10000000502b7d72\0",
      fallbackIdentity: "machine",
    })).toBe("2B7D72");
  });

  it("uses a stable hashed fallback away from Raspberry Pi hardware", () => {
    const first = deriveControllerSetupId({ physicalSerial: "invalid", fallbackIdentity: "machine-a" });
    const second = deriveControllerSetupId({ fallbackIdentity: "machine-a" });
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-F0-9]{6}$/);
  });
});
