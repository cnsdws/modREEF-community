import { describe, expect, it } from "vitest";

import {
  alkalinityKit,
  readingIsValid,
} from "./alkalinityTestKits";

describe("alkalinity test-kit conversions", () => {
  it.each([
    ["api", 8, 8],
    ["aquaforest", 0.5, 7],
    ["elos", 16, 8],
    ["hanna-hi772", 8.3, 8.3],
    ["hanna-hi755", 143, 8.01],
    ["hanna-hi775", 125, 7],
    ["nyos", 8, 8],
    ["red-sea", 0.62, 8.68],
    ["salifert-high", 0.48, 8],
    ["salifert-low", 0.73, 8],
    ["seachem", 0.2, 8],
  ])("converts %s readings", (id, reading, expected) => {
    expect(alkalinityKit(id).calculateDkh(reading as number)).toBe(expected);
  });

  it("enforces integer drop counts", () => {
    const api = alkalinityKit("api");
    expect(readingIsValid(api, 8)).toBe(true);
    expect(readingIsValid(api, 8.5)).toBe(false);
    expect(readingIsValid(api, 13)).toBe(false);
  });
});
