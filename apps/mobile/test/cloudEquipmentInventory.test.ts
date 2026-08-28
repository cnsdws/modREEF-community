import { describe, expect, it } from "vitest";
import type { Equipment, PhysicalDevice } from "@modreef/digital-twin";
import { groupCloudEquipmentInventory } from "../src/cloudEquipmentInventory.js";

function outlet(id: string, deviceName: string): Equipment {
  return {
    id,
    aquariumId: "reef",
    name: id,
    role: "outlet",
    enabled: false,
    connectionStatus: "offline",
    healthStatus: "unknown",
    physicalDeviceName: deviceName,
    physicalDeviceId: deviceName === "Power Strip Right" ? "device-right" : "device-left",
    physicalConnectionId: "outlet-1",
    binding: {
      driverId: "test.driver",
      deviceId: deviceName === "Power Strip Right" ? "device-right" : "device-left",
      channelId: "outlet-1",
      capability: "power",
    },
  };
}

describe("cloud equipment inventory", () => {
  it("retains devices and outlets without requiring a live local controller", () => {
    const groups = groupCloudEquipmentInventory(
      [outlet("right-1", "Power Strip Right"), outlet("left-1", "Power Strip Left")],
      { "right-1": "Development Pi", "left-1": "Development Pi" },
      { "right-1": "edge-1", "left-1": "edge-1" },
    );

    expect(groups.map((group) => [group.controllerName, group.deviceName])).toEqual([
      ["Development Pi", "Power Strip Right"],
      ["Development Pi", "Power Strip Left"],
    ]);
    expect(groups.flatMap((group) => group.equipment).map((item) => item.id)).toEqual([
      "right-1",
      "left-1",
    ]);
    expect(groups.map((group) => [group.controllerId, group.deviceId])).toEqual([
      ["edge-1", "device-right"],
      ["edge-1", "device-left"],
    ]);
  });

  it("keeps a physical device visible even when it has no equipment channels", () => {
    const device: PhysicalDevice = {
      id: "device-empty", aquariumId: "reef", name: "Empty Device",
      manufacturer: "Test", model: "Test", driverId: "test:device-empty",
      connectionStatus: "unknown", createdAt: "2026-08-11T00:00:00Z",
    };
    const groups = groupCloudEquipmentInventory(
      [], {}, {}, [device], { "device-empty": "edge-1" },
      { "edge-1": "Controller 1" },
    );

    expect(groups).toEqual([expect.objectContaining({
      controllerId: "edge-1", controllerName: "Controller 1",
      deviceId: "device-empty", deviceName: "Empty Device", equipment: [],
    })]);
  });
});
