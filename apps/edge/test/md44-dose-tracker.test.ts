import { describe, expect, it } from "vitest";
import type { Equipment } from "@modreef/digital-twin";
import { trackMd44ScheduledDoses } from "../src/md44-dose-tracker.js";

const equipment = {
  id: "doser-1",
  aquariumId: "reef",
  name: "Alk Doser",
  role: "doser",
  enabled: false,
  connectionStatus: "online",
  healthStatus: "normal",
  binding: { driverId: "modreef.jebao-md44:abc", deviceId: "md44-abc", channelId: "1" },
  intervalProgram: {
    enabled: true,
    startTime: "13:00",
    durationSeconds: 20,
    doseMilliliters: 10,
    intervalSeconds: 10_800,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    fallbackState: "off",
    maximumDailyRuntimeSeconds: 480,
  },
} as Equipment;

describe("MD-4.4 deterministic dose journaling", () => {
  it("records calculated start and completion without claiming physical confirmation", () => {
    const started = trackMd44ScheduledDoses({}, [equipment], new Date("2026-08-05T16:00:01"));
    expect(started.transitions[0]).toMatchObject({
      action: "scheduled-dose-started",
      title: "Alk Doser scheduled dose started",
    });
    expect(started.transitions[0]?.details).toContain("motor operation is not reported");

    const completed = trackMd44ScheduledDoses(
      started.state,
      [equipment],
      new Date("2026-08-05T16:00:21"),
    );
    expect(completed.transitions[0]).toMatchObject({
      action: "scheduled-dose-completed",
      title: "Alk Doser scheduled dose completed",
    });
    expect(completed.transitions[0]?.details).toContain("calculated, not physically confirmed");
  });

  it("does not duplicate an occurrence across scheduler ticks", () => {
    const first = trackMd44ScheduledDoses({}, [equipment], new Date("2026-08-05T16:00:00"));
    const second = trackMd44ScheduledDoses(first.state, [equipment], new Date("2026-08-05T16:00:02"));
    expect(second.transitions).toEqual([]);
  });

  it("does not journal while the doser is offline or its program is disabled", () => {
    const offline = { ...equipment, connectionStatus: "offline" } as Equipment;
    const disabled = {
      ...equipment,
      intervalProgram: { ...equipment.intervalProgram!, enabled: false },
    } as Equipment;
    expect(trackMd44ScheduledDoses({}, [offline], new Date("2026-08-05T16:00:01")).transitions).toEqual([]);
    expect(trackMd44ScheduledDoses({}, [disabled], new Date("2026-08-05T16:00:01")).transitions).toEqual([]);
  });

  it("keeps a persisted anchor for multi-day programs", () => {
    const everyTwoDays = {
      ...equipment,
      intervalProgram: {
        ...equipment.intervalProgram!,
        startTime: "13:00",
        intervalSeconds: 172_800,
      },
    } as Equipment;
    const anchored = trackMd44ScheduledDoses({}, [everyTwoDays], new Date("2026-08-05T12:00:00"));
    expect(trackMd44ScheduledDoses(anchored.state, [everyTwoDays], new Date("2026-08-05T13:00:01")).transitions).toHaveLength(1);
    expect(trackMd44ScheduledDoses(anchored.state, [everyTwoDays], new Date("2026-08-06T13:00:01")).transitions).toEqual([]);
    expect(trackMd44ScheduledDoses(anchored.state, [everyTwoDays], new Date("2026-08-07T13:00:01")).transitions).toHaveLength(1);
  });
});
