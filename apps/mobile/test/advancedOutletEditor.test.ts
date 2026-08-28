import { describe, expect, it } from "vitest";
import {
  advancedProgramCompletions,
  applyAdvancedProgramCompletion,
  createAdvancedProgram,
  createAdvancedRule,
  createCondition,
  formatAdvancedProgramSource,
  moveAdvancedRule,
  parseAdvancedProgramSource,
} from "../src/advancedOutletEditor.js";

describe("advanced outlet form model", () => {
  it("creates a disabled fail-safe program for a new outlet", () => {
    expect(createAdvancedProgram("outlet-1", "Reactor")).toMatchObject({
      id: "outlet-1-advanced",
      revision: 1,
      enabled: false,
      defaultState: "off",
      fallbackState: "off",
      safety: { missingInputState: "off" },
    });
  });

  it("creates each supported basic condition", () => {
    expect(["time-range", "feed-cycle", "water-change", "measurement", "equipment-state", "oscillation"]
      .map((type) => createCondition(type as never).type)).toEqual([
        "time-range", "feed-cycle", "water-change", "measurement", "equipment-state", "oscillation",
      ]);
  });

  it("moves rules without mutating the source order", () => {
    const rules = [createAdvancedRule(0), createAdvancedRule(1), createAdvancedRule(2)];
    const moved = moveAdvancedRule(rules, 2, -1);
    expect(moved.map((rule) => rule.name)).toEqual(["Rule 1", "Rule 3", "Rule 2"]);
    expect(rules.map((rule) => rule.name)).toEqual(["Rule 1", "Rule 2", "Rule 3"]);
    expect(moveAdvancedRule(rules, 0, -1)).toBe(rules);
  });

  it("parses readable IF/THEN source into the runtime program", () => {
    const base = createAdvancedProgram("outlet-1", "Refugium");
    const result = parseAdvancedProgramSource([
      "# Reverse daylight with a temperature override",
      "DEFAULT OFF",
      "MISSING DATA OFF",
      "IF TIME 20:00 TO 08:00 DAYS SUN,MON,TUE,WED,THU,FRI,SAT THEN ON",
      "IF TEMPERATURE > 82 THEN OFF",
      "DEFER ON 300",
      "MAXIMUM CHANGES PER HOUR 6",
    ].join("\n"), base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.program.enabled).toBe(true);
    expect(result.program.rules).toHaveLength(2);
    expect(result.program.rules[0]?.condition).toMatchObject({
      type: "time-range", startTime: "20:00", endTime: "08:00",
    });
    expect(result.program.rules[1]?.condition).toMatchObject({
      type: "measurement", measurementId: "temperature", comparison: "gt", value: 82,
    });
    expect(result.program.safety).toMatchObject({
      missingInputState: "off", deferOnSeconds: 300, maximumTransitionsPerHour: 6,
    });
  });

  it("reports the source line for invalid commands", () => {
    const result = parseAdvancedProgramSource("DEFAULT OFF\nWHEN TEMP HOT", createAdvancedProgram("outlet-1", "Fan"));
    expect(result).toEqual({
      ok: false,
      issues: [{ line: 2, message: "Command not recognized. Check spelling and command order." }],
    });
  });

  it("treats a partially typed command as editing rather than an error", () => {
    const result = parseAdvancedProgramSource("DEFAULT OFF\nIF", createAdvancedProgram("outlet-1", "Fan"));
    expect(result).toEqual({
      ok: false,
      issues: [{ line: 2, message: "Finish this command.", incomplete: true }],
    });
  });

  it("formats a legacy form program as editable source", () => {
    const program = createAdvancedProgram("outlet-1", "Pump");
    program.rules = [{
      ...createAdvancedRule(0),
      condition: { type: "oscillation", offsetSeconds: 60, onSeconds: 120, offSeconds: 480 },
      action: { type: "set-power", state: "on" },
    }];
    expect(formatAdvancedProgramSource(program)).toContain("IF REPEAT ON 120 OFF 480 OFFSET 60 THEN ON");
  });

  it("suggests commands from the active line prefix", () => {
    const source = "DEFAULT OFF\nif t";
    expect(advancedProgramCompletions(source, source.length).map((item) => item.label)).toEqual([
      "Time rule", "Weekday time rule", "Temperature rule",
    ]);
    expect(advancedProgramCompletions(source, source.length)[0]?.source.startsWith("IF TIME")).toBe(true);
    expect(advancedProgramCompletions("DEFAULT OFF\n", 12)).toEqual([]);
  });

  it("applies a completion without replacing other lines", () => {
    const source = "DEFAULT OFF\nIF T\nMISSING DATA OFF";
    expect(applyAdvancedProgramCompletion(source, 16, "IF TEMPERATURE > 82 THEN OFF")).toEqual({
      source: "DEFAULT OFF\nIF TEMPERATURE > 82 THEN OFF\nMISSING DATA OFF",
      cursor: 40,
    });
  });
});
