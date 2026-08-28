import { describe, expect, it } from "vitest";
import type { AquariumDigitalTwin } from "../src/index";
import { getEquipmentSummary } from "../src/index";

const twin: AquariumDigitalTwin = {
  aquarium: {
    id: "reef",
    name: "Test Reef",
    description: "Test",
    displayVolumeGallons: 90,
    systemType: "reef",
    createdAt: "2026-07-11T00:00:00Z",
  },
  equipment: [
    {
      id: "return",
      aquariumId: "reef",
      name: "Return Pump",
      role: "return-pump",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
    },
    {
      id: "skimmer",
      aquariumId: "reef",
      name: "Skimmer",
      role: "skimmer",
      enabled: false,
      connectionStatus: "offline",
      healthStatus: "warning",
    },
  ],
  measurements: [],
  recommendations: [],
};

describe("getEquipmentSummary", () => {
  it("summarizes equipment state", () => {
    expect(getEquipmentSummary(twin)).toEqual({
      total: 2,
      online: 1,
      enabled: 1,
      needingAttention: 1,
    });
  });
});

describe("equipment mutations", () => {
  it("toggles equipment without mutating the original twin", async () => {
    const { toggleEquipmentEnabled } = await import("../src/index");

    const updated = toggleEquipmentEnabled(twin, "return");

    expect(updated.equipment[0]?.enabled).toBe(false);
    expect(twin.equipment[0]?.enabled).toBe(true);
  });

  it("throws when equipment does not exist", async () => {
    const { setEquipmentEnabled } = await import("../src/index");

    expect(() =>
      setEquipmentEnabled(twin, "missing-equipment", true),
    ).toThrow("Equipment not found: missing-equipment");
  });
});

describe("equipment control mode", () => {
  it("defaults legacy equipment to auto", async () => {
    const { getEquipmentControlMode } =
      await import("../src/index");

    expect(getEquipmentControlMode(twin.equipment[0]!)).toBe(
      "auto",
    );
  });

  it("updates control intent without changing physical state", async () => {
    const { setEquipmentControlMode } =
      await import("../src/index");

    const updated = setEquipmentControlMode(
      twin,
      "return",
      "off",
    );

    expect(updated.equipment[0]?.controlMode).toBe("off");
    expect(updated.equipment[0]?.enabled).toBe(true);
    expect(twin.equipment[0]?.controlMode).toBeUndefined();
  });
});
