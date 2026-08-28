import { describe, expect, it } from "vitest";

import type {
  AquariumDigitalTwin,
} from "@modreef/digital-twin";

import {
  createFeedModePlan,
  createWaterChangePlan,
  shouldRestoreFeedModeAction,
  shouldRestoreWaterChangeAction,
  validateRoutineDefinitionInput,
} from "../src/index.js";

function createTwin(): AquariumDigitalTwin {
  return {
    aquarium: {
      id: "reef",
      name: "Test Reef",
      description: "Automation test",
      displayVolumeGallons: 90,
      systemType: "reef",
      createdAt: "2026-07-16T00:00:00Z",
    },
    equipment: [
      {
        id: "return-pump",
        aquariumId: "reef",
        name: "Main Return Pump",
        role: "return-pump",
        enabled: true,
        connectionStatus: "online",
        healthStatus: "normal",
        binding: {
          driverId: "driver",
          deviceId: "strip",
          channelId: "outlet-1",
          capability: "power",
        },
      },
      {
        id: "skimmer",
        aquariumId: "reef",
        name: "Skimmer",
        role: "skimmer",
        enabled: false,
        connectionStatus: "online",
        healthStatus: "normal",
        binding: {
          driverId: "driver",
          deviceId: "strip",
          channelId: "outlet-2",
          capability: "power",
        },
      },
      {
        id: "lights",
        aquariumId: "reef",
        name: "Lights",
        role: "light",
        enabled: true,
        connectionStatus: "online",
        healthStatus: "normal",
      },
    ],
    measurements: [],
    recommendations: [],
  };
}

describe("createFeedModePlan", () => {
  it("targets reef equipment by role", () => {
    const plan = createFeedModePlan(createTwin(), {
      durationSeconds: 300,
      now: new Date("2026-07-16T12:00:00Z"),
    });

    expect(plan.intent).toBe("feed-mode");
    expect(plan.endsAt).toBe("2026-07-16T12:05:00.000Z");
    expect(plan.actions).toEqual([
      {
        equipmentId: "skimmer",
        turnOff: true,
        restoreOnCompletion: false,
        restoreDelaySeconds: 0,
      },
      {
        equipmentId: "return-pump",
        turnOff: true,
        restoreOnCompletion: true,
        restoreDelaySeconds: 0,
      },
    ]);
  });

  it("targets configured return pumps and skimmers on generic outlets", () => {
    const twin = createTwin();
    twin.equipment[0] = {
      ...twin.equipment[0]!,
      role: "outlet",
      programType: "return-pump",
    };
    twin.equipment[1] = {
      ...twin.equipment[1]!,
      role: "outlet",
      programType: "skimmer",
    };

    const plan = createFeedModePlan(twin, {
      durationSeconds: 300,
    });

    expect(plan.actions.map((action) => action.equipmentId)).toEqual([
      "skimmer",
      "return-pump",
    ]);
  });

  it("respects manual on and off overrides", () => {
    const twin = createTwin();
    twin.equipment[0]!.controlMode = "on";
    twin.equipment[1]!.controlMode = "off";

    expect(() =>
      createFeedModePlan(twin, {
        durationSeconds: 300,
      }),
    ).toThrow(
      "Feed mode requires a return pump or skimmer",
    );
  });

  it("rejects unsafe durations", () => {
    expect(() =>
      createFeedModePlan(createTwin(), {
        durationSeconds: 0,
      }),
    ).toThrow(
      "Feed mode duration must be between 1 and 3600 seconds",
    );
  });

  it("ignores the legacy feed-cycle restart delay", () => {
    const plan = createFeedModePlan(createTwin(), {
      durationSeconds: 300,
      skimmerRestartDelaySeconds: 180,
    });

    expect(plan.actions[0]).toMatchObject({
      equipmentId: "skimmer",
      restoreDelaySeconds: 0,
    });
  });
});

describe("water change routine", () => {
  it("pauses AUTO return pump, skimmer, and ATO equipment", () => {
    const twin = createTwin();
    twin.equipment.push({
      aquariumId: "reef",
      binding: {
        capability: "power",
        deviceId: "strip",
        driverId: "driver",
      },
      connectionStatus: "online",
      controlMode: "auto",
      enabled: true,
      healthStatus: "normal",
      id: "ato",
      name: "ATO",
      role: "ato",
    });

    const plan = createWaterChangePlan(
      twin,
      new Date("2026-07-22T12:00:00.000Z"),
    );

    expect(plan.intent).toBe("water-change");
    expect(plan.actions.map((action) => action.equipmentId).sort()).toEqual([
      "ato",
      "return-pump",
      "skimmer",
    ]);
  });

  it("does not restore equipment moved out of AUTO during the routine", () => {
    const twin = createTwin();
    const action = createWaterChangePlan(twin).actions.find(
      (item) => item.equipmentId === "return-pump",
    );

    expect(action).toBeDefined();
    twin.equipment[0]!.controlMode = "off";
    expect(shouldRestoreWaterChangeAction(twin, action!)).toBe(false);
  });

  it("reduces a variable-speed return pump instead of turning it off", () => {
    const twin = createTwin();
    twin.equipment = [{
      id: "mdp-return",
      aquariumId: twin.aquarium.id,
      name: "MDP Return Pump",
      role: "return-pump",
      enabled: true,
      controlMode: "auto",
      connectionStatus: "online",
      healthStatus: "normal",
      speedPercent: 72,
      binding: {
        driverId: "modreef.jebao.mdp",
        deviceId: "mdp-device",
        channelId: "pump",
        capability: "speed",
      },
    }];
    const plan = createFeedModePlan(twin, { durationSeconds: 300 });
    expect(plan.actions).toEqual([]);
    expect(plan.speedActions).toEqual([{
      equipmentId: "mdp-return",
      feedSpeedPercent: 30,
      restoreSpeedPercent: 72,
    }]);
  });

  it("uses the equipment selected in an editable routine", () => {
    const plan = createWaterChangePlan(
      createTwin(),
      new Date("2026-07-22T12:00:00.000Z"),
      new Set(["skimmer"]),
    );

    expect(plan.actions.map((action) => action.equipmentId)).toEqual([
      "skimmer",
    ]);
  });
});

describe("shouldRestoreFeedModeAction", () => {
  const action = {
    equipmentId: "return-pump",
    turnOff: true as const,
    restoreOnCompletion: true,
    restoreDelaySeconds: 0,
  };

  it("restores equipment that remains in auto mode", () => {
    expect(
      shouldRestoreFeedModeAction(createTwin(), action),
    ).toBe(true);
  });

  it("respects a manual override during Feed Mode", () => {
    const twin = createTwin();
    twin.equipment[0] = {
      ...twin.equipment[0]!,
      controlMode: "off",
    };

    expect(
      shouldRestoreFeedModeAction(twin, action),
    ).toBe(false);
  });
});

describe("validateRoutineDefinitionInput", () => {
  it("accepts ordered power, dose, wait, hold, and restore tasks", () => {
    expect(() => validateRoutineDefinitionInput(
      {
        name: "Maintenance",
        tasks: [
          { id: "off", type: "power", equipmentId: "return-pump", enabled: false },
          { id: "dose", type: "dose", equipmentId: "alk-doser", milliliters: 1.1 },
          { id: "wait", type: "wait", durationSeconds: 30 },
          { id: "hold", type: "hold" },
          { id: "restore", type: "restore" },
        ],
      },
      new Set(["return-pump"]),
      new Set(["alk-doser"]),
    )).not.toThrow();
  });

  it("rejects more than one wait-until-finished task", () => {
    expect(() => validateRoutineDefinitionInput({
      name: "Too many manual holds",
      tasks: [
        { id: "hold-1", type: "hold" },
        { id: "hold-2", type: "hold" },
      ],
    })).toThrow("only one Wait until finished");
  });

  it("rejects missing equipment and unsafe wait durations", () => {
    expect(() => validateRoutineDefinitionInput(
      {
        name: "Bad equipment",
        tasks: [
          { id: "off", type: "power", equipmentId: "missing", enabled: false },
        ],
      },
      new Set(["return-pump"]),
    )).toThrow("Equipment is not available");

    expect(() => validateRoutineDefinitionInput({
      name: "Bad wait",
      tasks: [{ id: "wait", type: "wait", durationSeconds: 0 }],
    })).toThrow("Wait tasks must be between");

    expect(() => validateRoutineDefinitionInput(
      {
        name: "Bad dose",
        tasks: [
          { id: "dose", type: "dose", equipmentId: "missing", milliliters: 1 },
        ],
      },
      new Set(["return-pump"]),
      new Set(["alk-doser"]),
    )).toThrow("Calibrated dosing pump is not available");

    expect(() => validateRoutineDefinitionInput({
      name: "Unsafe dose",
      tasks: [
        { id: "dose", type: "dose", equipmentId: "alk-doser", milliliters: 0 },
      ],
    })).toThrow("Dose tasks must be between");
  });
});
