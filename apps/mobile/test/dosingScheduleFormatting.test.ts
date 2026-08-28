import { describe, expect, it } from "vitest";
import {
  durationText,
  formatTimeInput,
} from "../src/dosingScheduleFormatting";

describe("dosing schedule formatting", () => {
  it("inserts the 24-hour time separator while typing", () => {
    expect(formatTimeInput("09")).toBe("09");
    expect(formatTimeInput("093")).toBe("09:3");
    expect(formatTimeInput("0930")).toBe("09:30");
    expect(formatTimeInput("09:30")).toBe("09:30");
  });

  it("summarizes long intervals in hours and minutes", () => {
    expect(durationText(86_400)).toBe("24 hours");
    expect(durationText(9_000)).toBe("2 hours 30 minutes");
    expect(durationText(3_661)).toBe("1 hour 1 minute 1 second");
  });
});
