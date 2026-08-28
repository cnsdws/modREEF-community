import { describe, expect, it } from "vitest";

import {
  advancedOutletProgramSchema,
  isAdvancedOutletProgram,
  validateAdvancedOutletProgram,
  type AdvancedOutletProgram,
} from "../src/index.js";

const program: AdvancedOutletProgram = {
  schema: advancedOutletProgramSchema,
  version: 1,
  id: "return-pump-advanced",
  revision: 1,
  name: "Return pump safeguards",
  enabled: true,
  defaultState: "on",
  fallbackState: "on",
  rules: [
    {
      id: "feed-a",
      name: "Pause for feeding",
      enabled: true,
      condition: { type: "feed-cycle", cycle: "A", active: true },
      action: { type: "set-power", state: "off" },
    },
    {
      id: "high-temperature",
      name: "Stop on high temperature",
      enabled: true,
      condition: {
        type: "all",
        conditions: [
          { type: "measurement", measurementId: "temperature", comparison: "gt", value: 82, unit: "degF" },
          { type: "equipment-connectivity", equipmentId: "temperature-probe", state: "online" },
        ],
      },
      action: { type: "set-power", state: "off" },
    },
  ],
  safety: {
    missingInputState: "off",
    deferOnSeconds: 30,
    deferOffSeconds: 0,
    minimumOnSeconds: 60,
    minimumOffSeconds: 300,
    maximumContinuousOnSeconds: 43_200,
    maximumTransitionsPerHour: 6,
  },
  updatedAt: "2026-08-03T12:00:00.000Z",
};

describe("advanced outlet program document", () => {
  it("accepts a valid version-one ordered rule document", () => {
    expect(validateAdvancedOutletProgram(program)).toEqual([]);
    expect(isAdvancedOutletProgram(program)).toBe(true);
  });

  it("rejects unsupported versions without silently interpreting them", () => {
    const unsupported = { ...program, version: 2 };
    expect(isAdvancedOutletProgram(unsupported)).toBe(false);
    expect(validateAdvancedOutletProgram(unsupported)).toContainEqual({
      path: "$.version",
      message: "Unsupported program version.",
    });
  });

  it("rejects duplicate rule IDs and invalid safety limits", () => {
    const invalid = {
      ...program,
      rules: [program.rules[0], { ...program.rules[1], id: program.rules[0]!.id }],
      safety: { ...program.safety, maximumTransitionsPerHour: 0 },
    };
    const issues = validateAdvancedOutletProgram(invalid);
    expect(issues.some((issue) => issue.path === "$.rules[1].id")).toBe(true);
    expect(issues.some((issue) => issue.path === "$.safety.maximumTransitionsPerHour")).toBe(true);
  });

  it("bounds condition nesting", () => {
    let condition: unknown = { type: "feed-cycle", cycle: "A", active: true };
    for (let index = 0; index < 12; index += 1) condition = { type: "not", condition };
    const invalid = { ...program, rules: [{ ...program.rules[0], condition }] };
    expect(validateAdvancedOutletProgram(invalid).some((issue) =>
      issue.message.includes("nesting"))).toBe(true);
  });
});
