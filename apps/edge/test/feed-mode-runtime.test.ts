import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AquariumDigitalTwin } from "@modreef/digital-twin";

const harness = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  events: [] as Array<Record<string, unknown>>,
  commands: [] as Array<{ equipmentId: string; on: boolean }>,
  speedCommands: [] as Array<{ equipmentId: string; percent: number }>,
  failEquipmentId: undefined as string | undefined,
  twin: undefined as AquariumDigitalTwin | undefined,
}));

vi.mock("../src/equipment-runtime.js", () => ({
  getTwin: () => structuredClone(harness.twin),
  initializeEquipment: vi.fn(async () => undefined),
  recordAquariumActivity: (event: Record<string, unknown>) => {
    harness.events.push(event);
  },
  runtimeStore: {
    deleteState: (key: string) => harness.state.delete(key),
    loadState: <T>(key: string): T | undefined =>
      structuredClone(harness.state.get(key)) as T | undefined,
    saveState: (key: string, value: unknown) => {
      harness.state.set(key, structuredClone(value));
    },
  },
  setEquipmentPower: vi.fn(async (equipmentId: string, on: boolean) => {
    harness.commands.push({ equipmentId, on });

    if (harness.failEquipmentId === equipmentId) {
      throw new Error(`Simulated command failure: ${equipmentId}`);
    }

    const equipment = harness.twin?.equipment.find(
      (item) => item.id === equipmentId,
    );

    if (!equipment) {
      throw new Error(`Missing equipment: ${equipmentId}`);
    }

    equipment.enabled = on;
    return { equipment, twin: structuredClone(harness.twin) };
  }),
  setEquipmentSpeed: vi.fn(async (equipmentId: string, percent: number) => {
    harness.speedCommands.push({ equipmentId, percent });
    const equipment = harness.twin?.equipment.find((item) => item.id === equipmentId);
    if (!equipment) throw new Error(`Missing equipment: ${equipmentId}`);
    equipment.speedPercent = percent;
    return { equipment, twin: structuredClone(harness.twin) };
  }),
  startEquipmentDose: vi.fn(),
}));

function createTwin(): AquariumDigitalTwin {
  return {
    aquarium: {
      id: "reef",
      name: "Acceptance Reef",
      description: "Feed Mode acceptance test",
      displayVolumeGallons: 90,
      systemType: "reef",
      createdAt: "2026-07-27T00:00:00.000Z",
    },
    equipment: [
      {
        id: "return-pump",
        aquariumId: "reef",
        name: "Return Pump",
        role: "return-pump",
        enabled: true,
        controlMode: "auto",
        connectionStatus: "online",
        healthStatus: "normal",
        binding: {
          driverId: "modreef.ghome.wp12",
          deviceId: "ghome-wp12",
          channelId: "outlet-1",
          capability: "power",
        },
      },
      {
        id: "skimmer",
        aquariumId: "reef",
        name: "Protein Skimmer",
        role: "skimmer",
        enabled: true,
        controlMode: "auto",
        connectionStatus: "online",
        healthStatus: "normal",
        binding: {
          driverId: "modreef.ghome.wp12",
          deviceId: "ghome-wp12",
          channelId: "outlet-2",
          capability: "power",
        },
      },
    ],
    measurements: [],
    recommendations: [],
  };
}

async function loadRuntime() {
  return import("../src/automation-runtime.js");
}

describe("Feed Mode runtime acceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    vi.resetModules();
    harness.state.clear();
    harness.events.length = 0;
    harness.commands.length = 0;
    harness.speedCommands.length = 0;
    harness.failEquipmentId = undefined;
    harness.twin = createTwin();
  });

  it("pauses configured equipment, persists the plan, restores it, and logs the cycle", async () => {
    const runtime = await loadRuntime();
    const plan = await runtime.startFeedMode(300);

    expect(harness.commands).toEqual([
      { equipmentId: "skimmer", on: false },
      { equipmentId: "return-pump", on: false },
    ]);
    expect(harness.state.get("active-feed-mode")).toMatchObject({ id: plan.id });

    await runtime.completeFeedMode();

    expect(harness.commands.slice(2)).toEqual([
      { equipmentId: "return-pump", on: true },
      { equipmentId: "skimmer", on: true },
    ]);
    expect(harness.state.has("active-feed-mode")).toBe(false);
    expect(harness.events.map((event) => event.action)).toEqual([
      "started",
      "completed",
    ]);
  });

  it("executes an advanced outlet program and persists its runtime state", async () => {
    harness.twin!.equipment[0] = {
      ...harness.twin!.equipment[0]!,
      programType: "advanced",
      advancedOutletProgram: {
        schema: "modreef.advanced-outlet-program",
        version: 1,
        id: "return-program",
        revision: 1,
        name: "Return safeguards",
        enabled: true,
        defaultState: "off",
        fallbackState: "off",
        rules: [],
        safety: {
          missingInputState: "off",
          deferOnSeconds: 0,
          deferOffSeconds: 0,
          minimumOnSeconds: 0,
          minimumOffSeconds: 0,
        },
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
    };
    const runtime = await loadRuntime();
    await runtime.applyEquipmentSchedules(new Date("2026-07-27T12:00:00.000Z"));

    expect(harness.commands).toContainEqual({ equipmentId: "return-pump", on: false });
    expect(harness.state.get("advanced-outlet-runtime:return-pump")).toMatchObject({
      version: 1,
      programId: "return-program",
      observedState: "on",
    });
  });

  it("applies an advanced program defer across scheduler passes", async () => {
    harness.twin!.equipment[0] = {
      ...harness.twin!.equipment[0]!,
      enabled: false,
      programType: "advanced",
      advancedOutletProgram: {
        schema: "modreef.advanced-outlet-program",
        version: 1,
        id: "deferred-program",
        revision: 1,
        name: "Deferred start",
        enabled: true,
        defaultState: "on",
        fallbackState: "off",
        rules: [],
        safety: {
          missingInputState: "off",
          deferOnSeconds: 10,
          deferOffSeconds: 0,
          minimumOnSeconds: 0,
          minimumOffSeconds: 0,
        },
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
    };
    const runtime = await loadRuntime();
    await runtime.applyEquipmentSchedules(new Date("2026-07-27T12:00:00.000Z"));
    expect(harness.commands).toEqual([]);

    await runtime.applyEquipmentSchedules(new Date("2026-07-27T12:00:10.000Z"));
    expect(harness.commands).toEqual([{ equipmentId: "return-pump", on: true }]);
  });

  it("does not let an advanced program undo a Feed Mode shutdown", async () => {
    harness.twin!.equipment[0] = {
      ...harness.twin!.equipment[0]!,
      programType: "advanced",
      advancedOutletProgram: {
        schema: "modreef.advanced-outlet-program",
        version: 1,
        id: "always-on-program",
        revision: 1,
        name: "Normally on",
        enabled: true,
        defaultState: "on",
        fallbackState: "on",
        rules: [],
        safety: {
          missingInputState: "off",
          deferOnSeconds: 0,
          deferOffSeconds: 0,
          minimumOnSeconds: 0,
          minimumOffSeconds: 0,
        },
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
    };
    const runtime = await loadRuntime();
    await runtime.startFeedMode(300);
    harness.commands.length = 0;

    await runtime.applyEquipmentSchedules(new Date("2026-07-27T12:01:00.000Z"));
    expect(harness.commands).toEqual([]);
    expect(harness.twin!.equipment[0]!.enabled).toBe(false);
  });

  it("resolves the newest measurement through its stable parameter alias", async () => {
    harness.twin!.measurements = [
      { id: "temp-old", aquariumId: "reef", parameter: "temperature", value: 79, unit: "degF", measuredAt: "2026-07-27T11:00:00.000Z", source: "sensor" },
      { id: "temp-new", aquariumId: "reef", parameter: "temperature", value: 83, unit: "degF", measuredAt: "2026-07-27T11:59:00.000Z", source: "sensor" },
    ];
    harness.twin!.equipment[0] = {
      ...harness.twin!.equipment[0]!,
      programType: "advanced",
      advancedOutletProgram: {
        schema: "modreef.advanced-outlet-program",
        version: 1,
        id: "temperature-program",
        revision: 1,
        name: "Temperature shutdown",
        enabled: true,
        defaultState: "on",
        fallbackState: "off",
        rules: [{
          id: "hot",
          name: "High temperature",
          enabled: true,
          condition: { type: "measurement", measurementId: "temperature", comparison: "gt", value: 82, unit: "degF" },
          action: { type: "set-power", state: "off" },
        }],
        safety: {
          missingInputState: "off",
          deferOnSeconds: 0,
          deferOffSeconds: 0,
          minimumOnSeconds: 0,
          minimumOffSeconds: 0,
        },
        updatedAt: "2026-07-27T12:00:00.000Z",
      },
    };
    const runtime = await loadRuntime();
    await runtime.applyEquipmentSchedules(new Date("2026-07-27T12:00:00.000Z"));
    expect(harness.commands).toContainEqual({ equipmentId: "return-pump", on: false });
  });

  it("preserves a manual OFF override when the feed cycle finishes", async () => {
    const runtime = await loadRuntime();
    await runtime.startFeedMode(300);

    harness.twin!.equipment[0]!.controlMode = "off";
    await runtime.completeFeedMode();

    expect(harness.commands.slice(2)).toEqual([
      { equipmentId: "skimmer", on: true },
    ]);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(harness.commands.slice(2)).toEqual([
      { equipmentId: "skimmer", on: true },
    ]);
  });

  it("returns the active cycle when a start command is retried", async () => {
    const runtime = await loadRuntime();
    const firstPlan = await runtime.startFeedMode(300);
    const commandCount = harness.commands.length;

    const retriedPlan = await runtime.startFeedMode(300);

    expect(retriedPlan).toEqual(firstPlan);
    expect(harness.commands).toHaveLength(commandCount);
    expect(harness.state.get("active-feed-mode")).toMatchObject({ id: firstPlan.id });
  });

  it("rolls back already-paused equipment when startup fails", async () => {
    const runtime = await loadRuntime();
    harness.failEquipmentId = "return-pump";

    await expect(runtime.startFeedMode(300)).rejects.toThrow(
      "Simulated command failure: return-pump",
    );

    expect(harness.commands).toEqual([
      { equipmentId: "skimmer", on: false },
      { equipmentId: "return-pump", on: false },
      { equipmentId: "return-pump", on: true },
      { equipmentId: "skimmer", on: true },
    ]);
    expect(harness.state.has("active-feed-mode")).toBe(false);
  });

  it("re-applies a persisted active cycle after an Edge restart", async () => {
    const firstRuntime = await loadRuntime();
    await firstRuntime.startFeedMode(300);
    harness.commands.length = 0;

    vi.resetModules();
    const restartedRuntime = await loadRuntime();
    await restartedRuntime.initializeAutomation();

    expect(harness.commands).toEqual([
      { equipmentId: "skimmer", on: false },
      { equipmentId: "return-pump", on: false },
    ]);
    expect(restartedRuntime.getActiveFeedMode()).toBeDefined();
  });

  it("resumes a persisted equipment restart delay after an Edge restart", async () => {
    harness.twin!.equipment[1]!.automaticRestartDelaySeconds = 120;
    harness.twin!.equipment[1]!.programType = "skimmer";
    const firstRuntime = await loadRuntime();
    await firstRuntime.startFeedMode(300);
    await firstRuntime.completeFeedMode();
    harness.commands.length = 0;

    expect(harness.state.has("active-feed-mode")).toBe(false);
    expect(harness.state.get("pending-automatic-restarts")).toEqual([{
      equipmentId: "skimmer",
      dueAt: "2026-07-27T12:02:00.000Z",
      reason: "Restarted after feed cycle",
    }]);
    expect(Date.now()).toBe(
      new Date("2026-07-27T12:00:00.000Z").getTime(),
    );

    vi.clearAllTimers();
    vi.resetModules();
    vi.setSystemTime(new Date("2026-07-27T12:00:01.000Z"));
    const restartedRuntime = await loadRuntime();
    await restartedRuntime.initializeAutomation();

    expect(harness.commands).toEqual([]);
    await vi.advanceTimersByTimeAsync(119_000);

    expect(harness.commands).toEqual([
      { equipmentId: "skimmer", on: true },
    ]);
    expect(restartedRuntime.getActiveFeedMode()).toBeUndefined();
  });

  it("restores an expired cycle from the scheduler if its timer is lost", async () => {
    const runtime = await loadRuntime();
    await runtime.startFeedMode(300);
    vi.clearAllTimers();
    vi.setSystemTime(new Date("2026-07-27T12:05:00.000Z"));

    await runtime.applyEquipmentSchedules();

    expect(harness.commands.slice(2)).toEqual([
      { equipmentId: "return-pump", on: true },
      { equipmentId: "skimmer", on: true },
    ]);
    expect(runtime.getActiveFeedMode()).toBeUndefined();
  });

  it("holds a variable-speed return pump at 30% and restores its current program", async () => {
    harness.twin!.equipment.push({
      id: "mdp-return",
      aquariumId: "reef",
      name: "MDP Return Pump",
      role: "return-pump",
      enabled: true,
      controlMode: "auto",
      connectionStatus: "online",
      healthStatus: "normal",
      speedPercent: 70,
      speedSchedule: {
        enabled: true,
        events: [
          { id: "all-day", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00", speedPercent: 65 },
        ],
      },
      binding: {
        driverId: "modreef.jebao.mdp",
        deviceId: "mdp-device",
        channelId: "pump",
        capability: "speed",
      },
    });
    const runtime = await loadRuntime();
    await runtime.startFeedMode(300);
    expect(harness.speedCommands).toEqual([{ equipmentId: "mdp-return", percent: 30 }]);

    await runtime.applyEquipmentSchedules();
    expect(harness.speedCommands).toHaveLength(1);

    await runtime.completeFeedMode();
    expect(harness.speedCommands.at(-1)).toEqual({ equipmentId: "mdp-return", percent: 65 });
  });
});
