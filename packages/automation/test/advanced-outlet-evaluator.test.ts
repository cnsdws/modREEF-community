import { describe, expect, it } from "vitest";

import type { AdvancedOutletProgram } from "@modreef/digital-twin";
import {
  evaluateAdvancedOutletProgram,
  type AdvancedOutletEvaluationInputs,
} from "../src/index.js";

const baseProgram: AdvancedOutletProgram = {
  schema: "modreef.advanced-outlet-program",
  version: 1,
  id: "program-1",
  revision: 1,
  name: "Test program",
  enabled: true,
  defaultState: "on",
  fallbackState: "off",
  rules: [],
  safety: {
    missingInputState: "off",
    deferOnSeconds: 0,
    deferOffSeconds: 0,
    minimumOnSeconds: 0,
    minimumOffSeconds: 0,
  },
  updatedAt: "2026-08-03T12:00:00.000Z",
};

function inputs(overrides: Partial<AdvancedOutletEvaluationInputs> = {}): AdvancedOutletEvaluationInputs {
  return {
    clock: { now: "2026-08-03T12:00:00.000Z", weekday: 1, time: "12:00:00" },
    feedCycles: { A: false, B: false, C: false },
    waterChangeActive: false,
    measurements: {},
    equipment: {},
    ...overrides,
  };
}

function rule(
  id: string,
  condition: AdvancedOutletProgram["rules"][number]["condition"],
  state: "on" | "off",
): AdvancedOutletProgram["rules"][number] {
  return { id, name: id, enabled: true, condition, action: { type: "set-power", state } };
}

describe("advanced outlet rule evaluator", () => {
  it("uses the default state when no rule matches", () => {
    const result = evaluateAdvancedOutletProgram(baseProgram, inputs());
    expect(result).toMatchObject({ status: "evaluated", desiredState: "on", trace: [] });
  });

  it("evaluates in order so the last matching rule wins", () => {
    const program = {
      ...baseProgram,
      rules: [
        rule("first", { type: "feed-cycle", cycle: "A", active: true }, "off"),
        rule("last", { type: "water-change", active: true }, "on"),
      ],
    };
    const result = evaluateAdvancedOutletProgram(program, inputs({
      feedCycles: { A: true, B: false, C: false },
      waterChangeActive: true,
    }));
    expect(result.desiredState).toBe("on");
    expect(result.matchedRuleId).toBe("last");
    expect(result.trace.map((item) => item.proposedStateAfter)).toEqual(["off", "on"]);
  });

  it("skips disabled rules and returns no desired state for a disabled program", () => {
    const disabledRule = { ...rule("disabled", { type: "water-change", active: false }, "off"), enabled: false };
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [disabledRule] }, inputs()).trace[0]?.outcome).toBe("disabled");
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, enabled: false }, inputs())).toMatchObject({
      status: "disabled",
      desiredState: null,
    });
  });

  it("matches daytime and overnight ranges only on selected weekdays", () => {
    const day = rule("day", { type: "time-range", startTime: "08:00", endTime: "20:00", weekdays: [1] }, "off");
    const night = rule("night", { type: "time-range", startTime: "20:00", endTime: "08:00", weekdays: [1] }, "off");
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [day] }, inputs()).desiredState).toBe("off");
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [night] }, inputs({
      clock: { now: "2026-08-03T23:00:00.000Z", weekday: 1, time: "23:00:00" },
    })).desiredState).toBe("off");
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [day] }, inputs({
      clock: { now: "2026-08-04T12:00:00.000Z", weekday: 2, time: "12:00:00" },
    })).desiredState).toBe("on");
  });

  it("supports all, any, and not condition groups", () => {
    const condition = {
      type: "all" as const,
      conditions: [
        { type: "feed-cycle" as const, cycle: "A" as const, active: false },
        {
          type: "not" as const,
          condition: {
            type: "any" as const,
            conditions: [
              { type: "water-change" as const, active: true },
              { type: "feed-cycle" as const, cycle: "B" as const, active: true },
            ],
          },
        },
      ],
    };
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [rule("logic", condition, "off")] }, inputs()).desiredState).toBe("off");
  });

  it("compares measurements with exact units", () => {
    const temperature = rule("hot", {
      type: "measurement", measurementId: "temp", comparison: "gt", value: 82, unit: "degF",
    }, "off");
    const snapshot = inputs({ measurements: {
      temp: { value: 82.1, unit: "degF", measuredAt: "2026-08-03T11:59:55.000Z" },
    } });
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [temperature] }, snapshot).desiredState).toBe("off");
  });

  it("evaluates measurement freshness against the supplied instant", () => {
    const stale = rule("stale", {
      type: "measurement-stale", measurementId: "temp", staleAfterSeconds: 60,
    }, "off");
    const snapshot = inputs({ measurements: {
      temp: { value: 80, unit: "degF", measuredAt: "2026-08-03T11:58:00.000Z" },
    } });
    expect(evaluateAdvancedOutletProgram({ ...baseProgram, rules: [stale] }, snapshot).desiredState).toBe("off");
  });

  it("matches equipment power and connectivity snapshots", () => {
    const program = { ...baseProgram, rules: [
      rule("pump-off", { type: "equipment-state", equipmentId: "pump", state: "off" }, "off"),
      rule("probe-offline", { type: "equipment-connectivity", equipmentId: "probe", state: "offline" }, "off"),
    ] };
    const result = evaluateAdvancedOutletProgram(program, inputs({ equipment: {
      pump: { powerState: "off", connectivity: "online" },
      probe: { connectivity: "offline" },
    } }));
    expect(result.desiredState).toBe("off");
    expect(result.trace.every((item) => item.outcome === "matched")).toBe(true);
  });

  it("anchors oscillation to local midnight and honors its offset", () => {
    const oscillate = rule("osc", {
      type: "oscillation", offsetSeconds: 3_600, onSeconds: 60, offSeconds: 240,
    }, "off");
    const program = { ...baseProgram, rules: [oscillate] };
    expect(evaluateAdvancedOutletProgram(program, inputs({
      clock: { now: "2026-08-03T00:30:00.000Z", weekday: 1, time: "00:30:00" },
    })).desiredState).toBe("on");
    expect(evaluateAdvancedOutletProgram(program, inputs({
      clock: { now: "2026-08-03T01:00:30.000Z", weekday: 1, time: "01:00:30" },
    })).desiredState).toBe("off");
    expect(evaluateAdvancedOutletProgram(program, inputs({
      clock: { now: "2026-08-03T01:02:00.000Z", weekday: 1, time: "01:02:00" },
    })).desiredState).toBe("on");
  });

  it("uses the missing-input safety state and reports every unavailable dependency", () => {
    const program = { ...baseProgram, rules: [
      rule("temp", { type: "measurement", measurementId: "temp", comparison: "gt", value: 82, unit: "degF" }, "off"),
      rule("pump", { type: "equipment-state", equipmentId: "pump", state: "on" }, "on"),
    ] };
    const result = evaluateAdvancedOutletProgram(program, inputs());
    expect(result).toMatchObject({
      status: "missing-input",
      desiredState: "off",
      missingInputs: ["measurement:temp", "equipment:pump"],
    });
    expect(result.trace.map((item) => item.outcome)).toEqual(["unavailable", "unavailable"]);
  });

  it("treats a unit mismatch as unavailable instead of comparing unlike values", () => {
    const program = { ...baseProgram, rules: [rule("temp", {
      type: "measurement", measurementId: "temp", comparison: "gt", value: 28, unit: "degC",
    }, "off")] };
    const result = evaluateAdvancedOutletProgram(program, inputs({ measurements: {
      temp: { value: 82, unit: "degF", measuredAt: "2026-08-03T12:00:00.000Z" },
    } }));
    expect(result.status).toBe("missing-input");
    expect(result.desiredState).toBe("off");
  });
});
