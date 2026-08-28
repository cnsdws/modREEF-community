import { describe, expect, it } from "vitest";

import {
  phosphateKit,
  phosphateKitForEvent,
  phosphateKitsForBrand,
  phosphateReadingIsValid,
  phosphateTestKits,
} from "./phosphateTestKits";

describe("phosphate test kits", () => {
  it("includes direct entry and all seven manufacturers", () => {
    expect(phosphateTestKits.map((kit) => kit.brand)).toEqual(
      expect.arrayContaining([
        "None", "API", "Elos", "Hanna", "Nyos", "Red Sea", "Salifert", "Seachem",
      ]),
    );
  });

  it("models direct Hanna phosphate checkers", () => {
    expect(phosphateKit("phosphate-hanna-hi774").maximum).toBe(0.9);
    expect(phosphateKit("phosphate-hanna-hi717").maximum).toBe(30);
    expect(phosphateKit("phosphate-hanna-hi713").maximum).toBe(2.5);
  });

  it("converts Hanna phosphorus readings to phosphate ppm", () => {
    const ultraLow = phosphateKit("phosphate-hanna-hi736");
    const high = phosphateKit("phosphate-hanna-hi706");

    expect(ultraLow.calculatePpm(100)).toBeCloseTo(0.3066);
    expect(high.calculatePpm(1)).toBeCloseTo(3.066);
  });

  it("models Red Sea low and high color cards", () => {
    expect(phosphateKit("phosphate-red-sea-low").choices?.map((item) => item.value))
      .toEqual([0, 0.01, 0.02, 0.04, 0.08, 0.12, 0.16]);
    expect(phosphateKit("phosphate-red-sea-high").choices?.map((item) => item.value))
      .toEqual([0, 0.17, 0.34, 0.68, 1.36, 2.04, 2.72]);
  });

  it("models both Salifert sensitivities", () => {
    expect(phosphateKit("phosphate-salifert-low").choices?.map((item) => item.value))
      .toEqual([0, 0.03, 0.1, 0.25, 0.5, 1, 3]);
    expect(phosphateKit("phosphate-salifert-high").choices?.map((item) => item.value))
      .toEqual([0, 0.015, 0.05, 0.125, 0.25, 0.5, 1.5]);
  });

  it("validates color-card values exactly", () => {
    const nyos = phosphateKit("phosphate-nyos");
    expect(phosphateReadingIsValid(nyos, 0.075)).toBe(true);
    expect(phosphateReadingIsValid(nyos, 0.08)).toBe(false);
  });

  it("restores the saved kit variant from event metadata", () => {
    expect(
      phosphateKitForEvent({
        parameter: "phosphate",
        testKit: {
          brand: "Hanna",
          product: "HI736 Marine Phosphorus ULR",
          resolution: "Phosphorus ULR HI736",
          rawReading: 42,
        },
      })?.id,
    ).toBe("phosphate-hanna-hi736");

    expect(phosphateKitsForBrand("Hanna")).toHaveLength(5);
  });
});
