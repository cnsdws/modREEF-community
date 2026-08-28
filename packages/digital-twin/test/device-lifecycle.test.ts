import { describe, expect, it } from "vitest";

import {
  removePhysicalDevice,
  type AquariumDigitalTwin,
} from "../src/index.js";

describe("physical device lifecycle", () => {
  it("removes every child equipment channel across both identity fields", () => {
    const initial: AquariumDigitalTwin = {
      aquarium: {
        id: "reef",
        name: "Test Reef",
        description: "Test",
        displayVolumeGallons: 90,
        systemType: "reef",
        createdAt: "2026-08-11T00:00:00.000Z",
      },
      devices: [],
      equipment: [{
        id: "template",
        aquariumId: "reef",
        name: "Template",
        role: "outlet",
        enabled: false,
        connectionStatus: "unknown",
        healthStatus: "normal",
      }],
      measurements: [],
      recommendations: [],
    };
    const twin: AquariumDigitalTwin = {
      ...initial,
      devices: [{
        id: "device-1",
        aquariumId: initial.aquarium.id,
        name: "Device",
        manufacturer: "Test",
        model: "Test",
        driverId: "test:device-1",
        connectionStatus: "online" as const,
        createdAt: new Date().toISOString(),
      }],
      equipment: [
        {
          ...initial.equipment[0]!,
          id: "physical-only",
          physicalDeviceId: "device-1",
        },
        {
          ...initial.equipment[0]!,
          id: "binding-only",
          binding: {
            driverId: "test:device-1",
            deviceId: "device-1",
            capability: "power" as const,
          },
        },
        {
          ...initial.equipment[0]!,
          id: "unrelated",
          physicalDeviceId: "device-2",
        },
      ],
    };

    const removed = removePhysicalDevice(twin, "device-1");
    expect(removed.devices).toEqual([]);
    expect(removed.equipment.map(({ id }) => id)).toEqual(["unrelated"]);
  });
});
