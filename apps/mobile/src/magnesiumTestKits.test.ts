import { describe, expect, it } from "vitest";

import {
  magnesiumKit,
  magnesiumReadingIsValid,
} from "./magnesiumTestKits";

describe("magnesium test-kit conversions", () => {
  it.each([
    ["magnesium-aquaforest", 0.1, undefined, 1350],
    ["magnesium-elos", 28, 1, 1350],
    ["magnesium-hanna", 1350, undefined, 1350],
    ["magnesium-nyos", 0.9, undefined, 1350],
    ["magnesium-red-sea", 0.675, undefined, 1350],
    ["magnesium-salifert", 0.1, undefined, 1350],
    ["magnesium-seachem-first", 0.2, undefined, 1000],
    ["magnesium-seachem-second", 0.8, undefined, 1500],
  ])("converts %s readings", (id, reading, secondary, expected) => {
    expect(magnesiumKit(id).calculatePpm(reading, secondary)).toBe(
      expected,
    );
  });

  it("validates both Elos drop counts", () => {
    const kit = magnesiumKit("magnesium-elos");
    expect(magnesiumReadingIsValid(kit, 28, 1)).toBe(true);
    expect(magnesiumReadingIsValid(kit, 28, 1.5)).toBe(false);
    expect(magnesiumReadingIsValid(kit, 28)).toBe(false);
  });
});
