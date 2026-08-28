import { describe, expect, it } from "vitest";
import type { AquariumDigitalTwin, Equipment } from "@modreef/digital-twin";
import {
  cloneEquipmentConfigurationInTwin,
  swapEquipmentBindingsInTwin,
} from "../src/equipment-transfer.js";

function equipment(id: string, channelId: string, name: string): Equipment {
  return {
    id,
    aquariumId: "reef",
    name,
    role: id === "source" ? "return-pump" : "outlet",
    enabled: id !== "source",
    controlMode: id === "source" ? "auto" : "on",
    programType: id === "source" ? "schedule" : "always-on",
    schedule: id === "source"
      ? { enabled: true, events: [{ id: "event", weekdays: [1, 2], time: "08:00", desiredEnabled: true }] }
      : { enabled: false, events: [] },
    automaticRestartDelaySeconds: id === "source" ? 45 : 0,
    feedCycleParticipation: id === "source",
    ...(id === "source" ? { dosingParameter: "calcium" as const } : {}),
    connectionStatus: "online",
    healthStatus: "normal",
    binding: { driverId: "driver", deviceId: "strip", channelId, capability: "power" },
  };
}

function twin(): AquariumDigitalTwin {
  return {
    aquarium: { id: "reef", name: "Reef", description: "", displayVolumeGallons: 90, systemType: "reef", createdAt: "2026-01-01T00:00:00.000Z" },
    equipment: [
      equipment("source", "outlet-1", "Return Pump"),
      equipment("target", "outlet-2", "Spare"),
      equipment("usb-a", "usb", "USB A"),
      equipment("usb-b", "usb-2", "USB B"),
    ],
    measurements: [],
    recommendations: [],
  };
}

describe("equipment transfer operations", () => {
  it("clones automation and name while preserving binding and live state", () => {
    const result = cloneEquipmentConfigurationInTwin(twin(), "source", "target", "Backup Pump");
    const source = result.equipment.find((item) => item.id === "source")!;
    const target = result.equipment.find((item) => item.id === "target")!;
    expect(target.name).toBe("Backup Pump");
    expect(target.role).toBe(source.role);
    expect(target.programType).toBe(source.programType);
    expect(target.schedule?.events[0]?.id).not.toBe(source.schedule?.events[0]?.id);
    expect(target.binding?.channelId).toBe("outlet-2");
    expect(target.enabled).toBe(true);
    expect(target.controlMode).toBe("on");
    expect(target.automaticRestartDelaySeconds).toBe(45);
    expect(target.feedCycleParticipation).toBe(true);
    expect(target.dosingParameter).toBe("calcium");
  });

  it("swaps only physical bindings", () => {
    const result = swapEquipmentBindingsInTwin(twin(), "source", "target");
    const source = result.equipment.find((item) => item.id === "source")!;
    const target = result.equipment.find((item) => item.id === "target")!;
    expect(source.name).toBe("Return Pump");
    expect(source.binding?.channelId).toBe("outlet-2");
    expect(target.name).toBe("Spare");
    expect(target.binding?.channelId).toBe("outlet-1");
  });

  it("rejects AC-to-USB operations but permits USB-to-USB", () => {
    expect(() => swapEquipmentBindingsInTwin(twin(), "source", "usb-a")).toThrow("compatible");
    expect(() => swapEquipmentBindingsInTwin(twin(), "usb-a", "usb-b")).not.toThrow();
  });

  it("does not treat variable-speed hardware as interchangeable outlets", () => {
    const value = twin();
    value.equipment.push({
      ...equipment("speed-a", "pump", "Pump A"),
      binding: {
        driverId: "speed-driver", deviceId: "pump-a",
        channelId: "pump", capability: "speed",
      },
    }, {
      ...equipment("speed-b", "pump", "Pump B"),
      binding: {
        driverId: "speed-driver", deviceId: "pump-b",
        channelId: "pump", capability: "speed",
      },
    });

    expect(() => swapEquipmentBindingsInTwin(value, "speed-a", "speed-b"))
      .toThrow("compatible");
  });
});
