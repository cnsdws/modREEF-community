import { describe, expect, it } from "vitest";

import {
  potassiumKit,
  potassiumReadingIsValid,
  potassiumResultLabel,
} from "./potassiumTestKits";

describe("potassium test kits", () => {
  it("converts the Salifert drop card and preserves its upper bound", () => {
    const kit = potassiumKit("potassium-salifert");

    expect(kit.calculatePpm(3)).toBe(470);
    expect(potassiumResultLabel(kit, 3, 470)).toBe("≥470 ppm");
    expect(kit.calculatePpm(10)).toBe(400);
    expect(kit.calculatePpm(25)).toBe(250);
  });

  it("converts the shared Giesemann and Colombo titration", () => {
    expect(potassiumKit("potassium-giesemann").calculatePpm(0.48)).toBe(
      380,
    );
    expect(
      potassiumKit("potassium-colombo-marine").calculatePpm(0.4),
    ).toBe(400);
  });

  it("converts Red Sea titrant volume", () => {
    const kit = potassiumKit("potassium-red-sea");

    expect(kit.calculatePpm(0.01)).toBe(467);
    expect(kit.calculatePpm(0.5)).toBe(320);
  });

  it("applies Fauna Marin and Tropic Marin correction values", () => {
    expect(
      potassiumKit("potassium-fauna-marin").calculatePpm(0.4, -20),
    ).toBe(380);
    expect(
      potassiumKit("potassium-tropic-marin").calculatePpm(0.48, -20),
    ).toBe(400);
  });

  it("validates integer drops and required correction values", () => {
    const salifert = potassiumKit("potassium-salifert");
    const faunaMarin = potassiumKit("potassium-fauna-marin");

    expect(potassiumReadingIsValid(salifert, 10)).toBe(true);
    expect(potassiumReadingIsValid(salifert, 10.5)).toBe(false);
    expect(potassiumReadingIsValid(faunaMarin, 0.4)).toBe(false);
    expect(potassiumReadingIsValid(faunaMarin, 0.4, -20)).toBe(true);
  });
});
