import { describe, expect, it } from "vitest";

import {
  ironKit,
  ironKitForEvent,
  ironReadingIsValid,
} from "./ironTestKits";

describe("iron test kits", () => {
  it("converts Hanna HI746 ppb readings to ppm", () => {
    expect(ironKit("iron-hanna-hi746").calculatePpm(48)).toBe(0.048);
  });

  it("converts Seachem low-range card readings", () => {
    expect(ironKit("iron-seachem-low").calculatePpm(0.2)).toBe(0.05);
  });

  it("restricts color-card kits to their printed table", () => {
    const redSea = ironKit("iron-red-sea");
    expect(ironReadingIsValid(redSea, 0.25)).toBe(true);
    expect(ironReadingIsValid(redSea, 0.2)).toBe(false);
  });

  it("restores the recorded Seachem range", () => {
    expect(ironKitForEvent({
      parameter: "iron",
      testKit: {
        brand: "Seachem",
        product: "MultiTest Iron",
        resolution: "Low range",
        rawReading: 0.2,
      },
    })?.id).toBe("iron-seachem-low");
  });
});
