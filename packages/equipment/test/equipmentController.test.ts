import { describe, expect, it } from "vitest";

import type {
  AquariumDigitalTwin,
} from "@modreef/digital-twin";

import {
  SimulatedSmartStripDriver,
} from "@modreef/driver-simulator";

import {
  EquipmentController,
  getStableOperationalState,
  getTransitionalState,
} from "../src/index";

function createTwin(): AquariumDigitalTwin {
  return {
    aquarium: {
      id: "reef",
      name: "Test Reef",
      description: "Equipment test",
      displayVolumeGallons: 90,
      systemType: "reef",
      createdAt: "2026-07-11T00:00:00Z",
    },

    equipment: [
      {
        id: "skimmer",
        aquariumId: "reef",
        name: "Protein Skimmer",
        role: "skimmer",
        enabled: false,
        connectionStatus: "online",
        healthStatus: "normal",
        binding: {
          driverId: "modreef.simulator.smart-strip",
          deviceId: "simulated-smart-strip",
          channelId: "outlet-2",
          capability: "power",
        },
      },
    ],

    measurements: [],
    recommendations: [],
  };
}

describe("EquipmentController", () => {
  it("updates the twin only after the driver confirms power", async () => {
    const driver = new SimulatedSmartStripDriver();
    const controller = new EquipmentController([driver]);
    const twin = createTwin();

    await controller.connectBoundEquipment(twin);

    const result = await controller.setPower(
      twin,
      "skimmer",
      true,
    );

    expect(result.equipment.enabled).toBe(true);
    expect(result.operationalState).toBe("running");

    expect(
      result.confirmedDeviceState?.channels["outlet-2"]
        ?.relayOn,
    ).toBe(true);

    expect(twin.equipment[0]?.enabled).toBe(false);
  });

  it("turns equipment off after confirmation", async () => {
    const driver = new SimulatedSmartStripDriver();
    const controller = new EquipmentController([driver]);
    const twin = createTwin();

    await controller.connectBoundEquipment(twin);

    const running = await controller.setPower(
      twin,
      "skimmer",
      true,
    );

    const stopped = await controller.setPower(
      running.twin,
      "skimmer",
      false,
    );

    expect(stopped.equipment.enabled).toBe(false);
    expect(stopped.operationalState).toBe("off");
  });

  it("saves OFF safely while disconnected without claiming confirmation", async () => {
    const driver = new SimulatedSmartStripDriver();
    const controller = new EquipmentController([driver]);
    const twin = createTwin();
    twin.equipment[0] = {
      ...twin.equipment[0]!,
      enabled: true,
      connectionStatus: "offline",
    };

    const result = await controller.setPower(twin, "skimmer", false);

    expect(result.equipment.enabled).toBe(false);
    expect(result.operationalState).toBe("disconnected");
    expect(result.confirmedDeviceState).toBeUndefined();
    expect(result.message).toMatch(/OFF was saved/);
  });

  it("starts a dosing program even when the physical channel role is outlet", async () => {
    const driver = new SimulatedSmartStripDriver();
    const controller = new EquipmentController([driver]);
    const twin = createTwin();
    twin.equipment[0] = {
      ...twin.equipment[0]!,
      role: "outlet",
      programType: "dosing-pump",
    };

    await controller.connectBoundEquipment(twin);

    const result = await controller.startDose(twin, "skimmer", 55);

    expect(result.equipment.enabled).toBe(true);
    expect(
      result.confirmedDeviceState?.channels["outlet-2"]?.relayOn,
    ).toBe(true);
  });

  it("rejects equipment without a binding", async () => {
    const driver = new SimulatedSmartStripDriver();
    const controller = new EquipmentController([driver]);
    const twin = createTwin();

    const { binding: _binding, ...unboundEquipment } = twin.equipment[0]!;
      twin.equipment[0] = unboundEquipment;

    await expect(
      controller.setPower(twin, "skimmer", true),
    ).rejects.toThrow(
      "Equipment is not bound to a device: skimmer",
    );
  });
});

describe("equipment operational state", () => {
  it("returns transitional states", () => {
    expect(getTransitionalState(true)).toBe("starting");
    expect(getTransitionalState(false)).toBe("stopping");
  });

  it("derives stable state from the Digital Twin", () => {
    const equipment = createTwin().equipment[0];

    expect(equipment).toBeDefined();

    expect(getStableOperationalState(equipment!)).toBe("off");
  });
});
