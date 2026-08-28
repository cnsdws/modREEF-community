import { describe, expect, it } from "vitest";

import {
  estimateMdpPowerWatts,
  publicEquipmentItem,
} from "../src/equipment-api";

describe("publicEquipmentItem", () => {
  it("exposes the physical channel without exposing the device binding", () => {
    const item = publicEquipmentItem(
      {
        id: "outlet-1",
        aquariumId: "reef",
        name: "Return Pump",
        role: "return-pump",
        enabled: true,
        connectionStatus: "online",
        healthStatus: "normal",
        binding: {
          driverId: "private-driver",
          deviceId: "private-device",
          channelId: "outlet-1",
          capability: "power",
        },
      },
      [
        {
          id: "private-device",
          aquariumId: "reef",
          name: "Main Power Strip",
          manufacturer: "GHome",
          model: "WP12",
          driverId: "private-driver",
          connectionStatus: "online",
          createdAt: "2026-07-23T00:00:00.000Z",
        },
      ],
    );

    expect(item.physicalConnectionId).toBe("outlet-1");
    expect(item.physicalDeviceName).toBe("Main Power Strip");
    expect(item.physicalDeviceId).toBe("private-device");
    expect(item.physicalCapability).toBe("power");
    expect(item.binding).toBeUndefined();
  });

  it("leaves unbound equipment without a physical connection", () => {
    const item = publicEquipmentItem({
      id: "light",
      aquariumId: "reef",
      name: "Light",
      role: "light",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
    });

    expect(item.physicalConnectionId).toBeUndefined();
  });

  it("exposes watts only when the bound channel reports watts", () => {
    const equipment = {
      id: "outlet-1",
      aquariumId: "reef",
      name: "Dosing Pump",
      role: "doser" as const,
      enabled: true,
      connectionStatus: "online" as const,
      healthStatus: "normal" as const,
    };

    expect(
      publicEquipmentItem(equipment, [], { watts: 4.2 }).powerWatts,
    ).toBe(4.2);
    expect(publicEquipmentItem(equipment).powerWatts).toBeUndefined();
  });

  it("exposes MDP power through the standard watts field", () => {
    expect([30, 40, 50, 60, 75, 90, 100].map((speed) => estimateMdpPowerWatts(speed))).toEqual(
      [17, 24, 31, 38, 48, 58, 65],
    );

    const pump = {
      id: "mdp-pump",
      aquariumId: "reef",
      name: "Return Pump",
      role: "return-pump" as const,
      enabled: true,
      speedPercent: 30,
      connectionStatus: "online" as const,
      healthStatus: "normal" as const,
      binding: {
        driverId: "modreef.jebao-mdp:mdp-123456789abc",
        deviceId: "mdp-123456789abc",
        channelId: "pump",
        capability: "speed" as const,
      },
    };

    expect(publicEquipmentItem(pump).powerWatts).toBe(17);
    expect(publicEquipmentItem({ ...pump, enabled: false }).powerWatts).toBe(0);
    expect(
      publicEquipmentItem({ ...pump, connectionStatus: "offline" }).powerWatts,
    ).toBe(0);
  });

  it("exposes cumulative energy only when the bound channel reports it", () => {
    const equipment = {
      id: "outlet-1",
      aquariumId: "reef",
      name: "Return Pump",
      role: "return-pump" as const,
      enabled: true,
      connectionStatus: "online" as const,
      healthStatus: "normal" as const,
    };

    expect(
      publicEquipmentItem(equipment, [], { energyKwh: 12.345 }).energyKwh,
    ).toBe(12.345);
    expect(publicEquipmentItem(equipment).energyKwh).toBeUndefined();
  });
});
