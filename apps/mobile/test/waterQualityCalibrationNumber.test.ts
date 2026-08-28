import { describe, expect, it } from "vitest";
import {
  formatCalibrationNumber,
  sanitizeCalibrationNumber,
} from "../src/waterQualityCalibrationNumber";

describe("water-quality calibration number entry", () => {
  it("limits calibration input to two whole and two decimal digits", () => {
    expect(sanitizeCalibrationNumber("123.456")).toBe("12.45");
    expect(sanitizeCalibrationNumber("35,009")).toBe("35.00");
    expect(sanitizeCalibrationNumber("4..567")).toBe("4.56");
  });

  it("allows a negative temperature correction only when requested", () => {
    expect(sanitizeCalibrationNumber("-12.345", true)).toBe("-12.34");
    expect(sanitizeCalibrationNumber("-12.345")).toBe("12.34");
  });

  it("formats completed values with two decimal places", () => {
    expect(formatCalibrationNumber("7.1")).toBe("7.10");
    expect(formatCalibrationNumber("-2.5", true)).toBe("-2.50");
    expect(formatCalibrationNumber("125")).toBe("99.99");
  });
});
