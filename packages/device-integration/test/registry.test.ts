import type { DeviceDriver } from "@modreef/hal";
import { describe, expect, it } from "vitest";

import {
  defineDeviceIntegration,
  DeviceIntegrationRegistry,
  type DeviceIntegrationManifest,
} from "../src/index.js";

const driver = { id: "driver.test", name: "Test" } as DeviceDriver;

function manifest(id = "modreef.test-device"): DeviceIntegrationManifest {
  return defineDeviceIntegration({
    schemaVersion: 1,
    id,
    displayName: "Test Device",
    manufacturer: "Test",
    models: ["One"],
    deviceClass: "other",
    support: "experimental",
    protocols: ["simulator"],
    capabilityKinds: ["relay"],
    onboarding: { methods: ["manual"], requiresNativeMobileModule: false },
    equipment: [],
    match: (input) => input.model === "One"
      ? { confidence: 0.9, reason: "model" }
      : null,
    validateRegistration: (input) => {
      if (!input || typeof input !== "object" || !("deviceId" in input)) {
        throw new Error("Invalid test registration");
      }
    },
    createDriver: () => driver,
  });
}

describe("DeviceIntegrationRegistry", () => {
  it("registers, identifies, and constructs a driver", () => {
    const registry = new DeviceIntegrationRegistry([manifest()]);
    expect(registry.identify({ model: "One" })[0]?.integration.id)
      .toBe("modreef.test-device");
    expect(registry.createDriver("modreef.test-device", { deviceId: "one" }))
      .toBe(driver);
  });

  it("rejects duplicate registrations", () => {
    const registry = new DeviceIntegrationRegistry([manifest()]);
    expect(() => registry.register(manifest())).toThrow(/already registered/);
  });

  it("validates registration before invoking the factory", () => {
    const registry = new DeviceIntegrationRegistry([manifest()]);
    expect(() => registry.createDriver("modreef.test-device", {}))
      .toThrow(/Invalid test registration/);
  });
});
