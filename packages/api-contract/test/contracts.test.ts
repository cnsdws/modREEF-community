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
