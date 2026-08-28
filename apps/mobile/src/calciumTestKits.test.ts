import { describe, expect, it } from "vitest";

import { calciumKit, calciumReadingIsValid } from "./calciumTestKits";

describe("calcium test-kit conversions", () => {
  it.each([
    ["calcium-api", 20, undefined, 400],
    ["calcium-aquaforest", 0.2, undefined, 400],
    ["calcium-elos", 8, 5, 450],
    ["calcium-hanna", 425, undefined, 425],
    ["calcium-nyos", 0.8, undefined, 400],
    ["calcium-red-sea", 0.8, undefined, 400],
    ["calcium-salifert-high", 0.2, undefined, 400],
    ["calcium-salifert-low", 0.6, undefined, 400],
    ["calcium-seachem", 0.2, undefined, 400],
  ])("converts %s readings", (id, reading, secondary, expected) => {
    expect(calciumKit(id).calculatePpm(reading, secondary)).toBe(expected);
  });

  it("validates both Elos drop counts", () => {
    const kit = calciumKit("calcium-elos");
    expect(calciumReadingIsValid(kit, 8, 5)).toBe(true);
    expect(calciumReadingIsValid(kit, 8, 20.5)).toBe(false);
    expect(calciumReadingIsValid(kit, 8)).toBe(false);
  });
});
