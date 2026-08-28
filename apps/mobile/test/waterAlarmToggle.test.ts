import { describe, expect, it } from "vitest";
import { defaultWaterAlarmRules } from "@modreef/api-contract";
import { toggledWaterAlarmRule, waterAlarmRuleWithRange } from "../src/waterAlarmRule";

describe("water alarm toggle", () => {
  it.each(["temperature", "ph", "orp", "salinity"] as const)(
    "toggles %s without changing its configured range",
    (metric) => {
      const rule = defaultWaterAlarmRules.metrics[metric];
      expect(toggledWaterAlarmRule(rule)).toEqual({ ...rule, enabled: false });
      expect(toggledWaterAlarmRule({ ...rule, enabled: false })).toEqual(rule);
    },
  );
});

describe("water alarm range", () => {
  it("saves both ORP limits atomically", () => {
    const rule = defaultWaterAlarmRules.metrics.orp;
    expect(waterAlarmRuleWithRange(rule, "225", "425")).toEqual({
      ...rule, lower: 225, upper: 425,
    });
  });

  it("rejects incomplete and reversed ranges", () => {
    const rule = defaultWaterAlarmRules.metrics.orp;
    expect(waterAlarmRuleWithRange(rule, "", "425")).toBeNull();
    expect(waterAlarmRuleWithRange(rule, "450", "425")).toBeNull();
  });
});
