import { describe, expect, it } from "vitest";

import type { AquariumDigitalTwin } from "@modreef/digital-twin";

import { ensureGHomeWp12Equipment } from "../src/ghome-wp12-equipment.js";

function createTwin(): AquariumDigitalTwin {
  return {
    aquarium: {
      id: "reef",
      name: "modREEF",
      description: "Test aquarium",
      displayVolumeGallons: 90,
      systemType: "reef",
      createdAt: "2026-07-18T00:00:00.000Z",
    },
    equipment: [
      {
        id: "return-pump",
        aquariumId: "reef",
        name: "Return Pump",
        role: "return-pump",
        enabled: false,
        connectionStatus: "unknown",
        healthStatus: "normal",
        binding: {
          driverId: "modreef.ghome.wp12",
          deviceId: "ghome-wp12",
          channelId: "outlet-1",
          capability: "power",
        },
      },
    ],
    measurements: [],
    recommendations: [],
  };
}

describe("ensureGHomeWp12Equipment", () => {
  it("adds every controllable WP12 channel", () => {
    const result = ensureGHomeWp12Equipment(
      createTwin(),
      "modreef.ghome.wp12",
      "ghome-wp12",
    );

    expect(
      result.equipment.map(
        (item) => item.binding?.channelId,
      ),
    ).toEqual([
      "outlet-1",
      "outlet-2",
      "outlet-3",
      "outlet-4",
      "outlet-5",
      "outlet-6",
      "usb",
    ]);

    expect(result.equipment[0]?.name).toBe("Return Pump");
    expect(result.equipment[0]?.role).toBe("return-pump");
    expect(
      result.equipment.every(
        (item) => item.controlMode === "auto",
      ),
    ).toBe(true);
  });

  it("does not duplicate existing channels", () => {
    const once = ensureGHomeWp12Equipment(
      createTwin(),
      "modreef.ghome.wp12",
      "ghome-wp12",
    );
    const twice = ensureGHomeWp12Equipment(
      once,
      "modreef.ghome.wp12",
      "ghome-wp12",
    );

    expect(twice.equipment).toHaveLength(7);
  });

  it("adds device-scoped outlets without changing legacy outlet IDs", () => {
    const first = ensureGHomeWp12Equipment(
      createTwin(), "modreef.ghome.wp12", "ghome-wp12",
    );
    const withDevice = {
      ...first,
      devices: [
        ...(first.devices ?? []),
        {
          id: "device-two",
          aquariumId: "reef",
          name: "Second GHome WP12",
          manufacturer: "GHome",
          model: "WP12",
          driverId: "modreef.ghome.wp12:device-two",
          connectionStatus: "unknown" as const,
          createdAt: "2026-07-27T00:00:00.000Z",
        },
      ],
    };
    const result = ensureGHomeWp12Equipment(
      withDevice, "modreef.ghome.wp12:device-two", "device-two",
    );

    expect(result.equipment).toHaveLength(14);
    expect(result.equipment.some((item) => item.id === "ghome-wp12-outlet-2")).toBe(true);
    expect(result.equipment.some((item) => item.id === "ghome-wp12-device-two-outlet-2")).toBe(true);
  });
});
