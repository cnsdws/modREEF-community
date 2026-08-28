import { describe, expect, it } from "vitest";
import type { AquariumDigitalTwin } from "@modreef/digital-twin";

import { addMatterDevice } from "../src/matter-equipment.js";

const twin: AquariumDigitalTwin = {
  aquarium: {
    id: "reef",
    name: "Reef",
    description: "",
    displayVolumeGallons: 90,
    systemType: "reef",
    createdAt: "2026-07-27T00:00:00.000Z",
  },
  equipment: [],
  measurements: [],
  recommendations: [],
};

describe("Matter equipment registration", () => {
  it("creates one physical device and only the advertised controllable endpoints", () => {
    const result = addMatterDevice(twin, {
      deviceId: "matter-123",
      driverId: "modreef.matter:matter-123",
      manufacturer: "TP-Link",
      model: "Tapo P316M",
      endpointIds: [2, 3, 4, 5, 6, 7],
    }, "Sump Strip");

    expect(result.devices).toHaveLength(1);
    expect(result.devices?.[0]?.name).toBe("Sump Strip");
    expect(result.equipment).toHaveLength(6);
    expect(result.equipment.map((item) => item.binding?.channelId)).toEqual([
      "endpoint-2",
      "endpoint-3",
      "endpoint-4",
      "endpoint-5",
      "endpoint-6",
      "endpoint-7",
    ]);
    expect(result.equipment.every((item) => item.binding?.capability === "power")).toBe(true);
  });
});
