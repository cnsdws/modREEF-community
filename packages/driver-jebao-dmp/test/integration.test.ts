import { describe, expect, it } from "vitest";

import { jebaoDmpIntegration } from "../src/integration.js";

describe("Jebao DMP integration", () => {
  it("matches the captured pairing identity", () => {
    expect(jebaoDmpIntegration.match({
      advertisedName: "W_CE32B4",
      serviceUuids: ["abf0"],
    })?.confidence).toBe(1);
  });

  it("rejects an unstable Bluetooth registration", () => {
    expect(() => jebaoDmpIntegration.validateRegistration({
      deviceId: "dmp-ce32b4",
      displayName: "Wavemaker",
      advertisedName: "W_CE32B4",
      bluetoothAddress: "unknown",
    })).toThrow(/Invalid Jebao DMP registration/);
  });
});
