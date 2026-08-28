import { describe, expect, it } from "vitest";

import {
  nitrateKit,
  nitrateKitForEvent,
  nitrateKitsForBrand,
  nitrateReadingIsValid,
  nitrateTestKits,
} from "./nitrateTestKits";

describe("nitrate test kits", () => {
  it("includes direct entry and all seven manufacturers", () => {
    expect(nitrateTestKits.map((kit) => kit.brand)).toEqual(
      expect.arrayContaining([
        "None", "API", "Elos", "Hanna", "Nyos", "Red Sea", "Salifert", "Seachem",
      ]),
    );
  });

  it("models the Hanna checker ranges and dilution", () => {
    const undiluted = nitrateKit("nitrate-hanna-hi781");
    const diluted = nitrateKit("nitrate-hanna-hi781-diluted");
    const high = nitrateKit("nitrate-hanna-hi782");

    expect(undiluted.maximum).toBe(5);
    expect(diluted.calculatePpm(4.2)).toBe(42);
    expect(high.maximum).toBe(75);
  });

  it("models the Red Sea 16x high-range procedure", () => {
    const low = nitrateKit("nitrate-red-sea-low");
    const high = nitrateKit("nitrate-red-sea-high");

    expect(low.calculatePpm(4)).toBe(4);
    expect(high.calculatePpm(4)).toBe(64);
    expect(high.choices?.map((item) => item.value)).toEqual(
      low.choices?.map((item) => item.value),
    );
  });

  it("models Salifert low and medium color cards", () => {
    expect(nitrateKit("nitrate-salifert-low").choices?.map((item) => item.value))
      .toEqual([0, 0.2, 0.5, 1, 2.5, 5, 10]);
    expect(nitrateKit("nitrate-salifert-medium").choices?.map((item) => item.value))
      .toEqual([0, 2, 5, 10, 25, 50, 100]);
  });

  it("validates color-card values exactly", () => {
    const api = nitrateKit("nitrate-api");
    expect(nitrateReadingIsValid(api, 20)).toBe(true);
    expect(nitrateReadingIsValid(api, 21)).toBe(false);
  });

  it("restores the saved kit variant from event metadata", () => {
    expect(
      nitrateKitForEvent({
        parameter: "nitrate",
        testKit: {
          brand: "Hanna",
          product: "HI781 Marine Nitrate LR",
          resolution: "LR (Diluted 10x) HI781",
          rawReading: 3.1,
        },
      })?.id,
    ).toBe("nitrate-hanna-hi781-diluted");

    expect(nitrateKitsForBrand("Hanna")).toHaveLength(3);
  });
});
