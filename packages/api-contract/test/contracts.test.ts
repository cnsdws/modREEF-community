import { describe, expect, it } from "vitest";

import {
  defaultWaterAlarmRules,
  isWaterAlarmRules,
  isCloudCommandRequest,
  isEdgeRuntimeState,
  isRunDoserCalibrationRequest,
  isSetEquipmentPowerRequest,
} from "../src/index.js";

describe("cloud command contracts", () => {
  it("requires routing, equipment, and an object payload", () => {
    const command = {
      commandId: "command-123",
      edgeId: "edge-1",
      equipmentId: "return-pump",
      type: "equipment.set-power",
      payload: { on: false },
    };
    expect(isCloudCommandRequest(command)).toBe(true);
    expect(isCloudCommandRequest({ ...command, edgeId: "" })).toBe(false);
    expect(isCloudCommandRequest({ ...command, payload: [] })).toBe(false);
  });
});

describe("controller reported state", () => {
  it("validates active Feed Cycle state", () => {
    expect(isEdgeRuntimeState({ feedCycle: null })).toBe(true);
    expect(isEdgeRuntimeState({ feedCycle: {
      id: "feed-1", status: "feeding", startedAt: "2026-07-31T12:00:00Z",
      endsAt: "2026-07-31T12:05:00Z", durationSeconds: 300,
    } })).toBe(true);
    expect(isEdgeRuntimeState({ feedCycle: { id: "feed-1", status: "unknown" } })).toBe(false);
  });

  it("validates controller-owned routine definitions and execution state", () => {
    const routine = {
      id: "routine-1",
      name: "Maintenance",
      tasks: [{ id: "task-1", type: "power", equipmentId: "pump-1", enabled: false }],
      createdAt: "2026-08-29T12:00:00Z",
      updatedAt: "2026-08-29T12:00:00Z",
    };
    expect(isEdgeRuntimeState({
      feedCycle: null,
      routines: {
        definitions: [routine],
        active: {
          id: "execution-1", routineId: routine.id, name: routine.name,
          startedAt: "2026-08-29T12:01:00Z", taskIndex: 0,
          snapshots: { "pump-1": true }, holding: true,
        },
      },
    })).toBe(true);
    expect(isEdgeRuntimeState({
      feedCycle: null,
      routines: { definitions: [{ ...routine, tasks: [{ id: "bad", type: "unknown" }] }], active: null },
    })).toBe(false);
  });
});

describe("equipment command contracts", () => {
  it("requires command identity for power changes", () => {
    expect(
      isSetEquipmentPowerRequest({
        commandId: "command-123",
        on: true,
      }),
    ).toBe(true);
    expect(isSetEquipmentPowerRequest({ on: true })).toBe(false);
  });

  it("accepts only qualified calibration durations", () => {
    for (const runtimeSeconds of [60, 300, 600]) {
      expect(
        isRunDoserCalibrationRequest({
          commandId: "command-123",
          runtimeSeconds,
        }),
      ).toBe(true);
    }
    expect(
      isRunDoserCalibrationRequest({
        commandId: "command-123",
        runtimeSeconds: 120,
      }),
    ).toBe(false);
  });
});

describe("water alarm contracts", () => {
  it("requires complete valid rules for all four supported water metrics", () => {
    expect(isWaterAlarmRules(defaultWaterAlarmRules)).toBe(true);
    expect(isWaterAlarmRules({
      ...defaultWaterAlarmRules,
      metrics: {
        ...defaultWaterAlarmRules.metrics,
        orp: { ...defaultWaterAlarmRules.metrics.orp, lower: 500, upper: 400 },
      },
    })).toBe(false);
    expect(isWaterAlarmRules({
      ...defaultWaterAlarmRules,
      metrics: { temperature: defaultWaterAlarmRules.metrics.temperature },
    })).toBe(false);
  });
});
