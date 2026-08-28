import { describe, expect, it } from "vitest";

import type { Equipment } from "@modreef/digital-twin";

import {
  formatWeekdays,
  getMaintenanceTasks,
  getScheduleRules,
  getTodayScheduleItems,
} from "../src/scheduleOverview";

function equipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    aquariumId: "reef",
    connectionStatus: "online",
    enabled: true,
    healthStatus: "normal",
    id: "light",
    name: "Reef Light",
    role: "light",
    ...overrides,
  };
}

describe("schedule overview", () => {
  it("formats common weekday groups", () => {
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(formatWeekdays([0, 6])).toBe("Weekends");
  });

  it("builds and sorts today's timeline", () => {
    const items = getTodayScheduleItems(
      [
        equipment({
          schedule: {
            enabled: true,
            events: [
              {
                desiredEnabled: false,
                id: "off",
                time: "20:00",
                weekdays: [3],
              },
              {
                desiredEnabled: true,
                id: "on",
                time: "08:00",
                weekdays: [3],
              },
            ],
          },
        }),
      ],
      new Date("2026-07-22T12:00:00"),
    );

    expect(items.map((item) => item.time)).toEqual(["08:00", "20:00"]);
  });

  it("marks overdue recalibration tasks", () => {
    const tasks = getMaintenanceTasks(
      [
        equipment({
          doserCalibration: {
            calibratedAt: "2026-01-01T00:00:00.000Z",
            dueAt: "2026-07-01T00:00:00.000Z",
            millilitersPerMinute: 1.1,
            recalibrationMonths: 6,
          },
        }),
      ],
      new Date("2026-07-22T12:00:00.000Z"),
    );

    expect(tasks[0]?.status).toBe("overdue");
  });

  it("includes disabled configured rules for management", () => {
    const rules = getScheduleRules([
      equipment({
        programType: "schedule",
        schedule: {
          enabled: false,
          events: [
            { desiredEnabled: true, id: "on", time: "08:00", weekdays: [1, 2, 3, 4, 5] },
            { desiredEnabled: false, id: "off", time: "20:00", weekdays: [1, 2, 3, 4, 5] },
          ],
        },
      }),
    ]);

    expect(rules).toMatchObject([
      { enabled: false, kind: "power", title: "08:00 ON · 20:00 OFF" },
    ]);
  });
});
