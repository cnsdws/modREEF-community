import type { Equipment } from "@modreef/digital-twin";

export interface Md44ScheduledDoseState {
  fingerprint: string;
  anchorLocalDate: string;
  lastStartedOccurrence?: string;
  lastCompletedOccurrence?: string;
}

export type Md44DoseTrackerState = Record<string, Md44ScheduledDoseState>;

export interface Md44DoseTransition {
  equipmentId: string;
  action: "scheduled-dose-started" | "scheduled-dose-completed";
  title: string;
  details: string;
}

export interface Md44DoseTrackerResult {
  state: Md44DoseTrackerState;
  transitions: Md44DoseTransition[];
  changed: boolean;
}

const daySeconds = 86_400;
const eventWindowMilliseconds = 3_000;

function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localDateOrdinal(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

function programFingerprint(equipment: Equipment): string {
  const program = equipment.intervalProgram!;
  return [
    program.startTime,
    program.intervalSeconds,
    program.durationSeconds,
    program.doseMilliliters ?? "",
    program.weekdays.join(","),
  ].join("|");
}

function doseSlots(equipment: Equipment, date: string): Array<{ key: string; start: Date; end: Date }> {
  const program = equipment.intervalProgram!;
  const [startHour, startMinute] = program.startTime.split(":").map(Number);
  const base = new Date(`${date}T00:00:00`);
  const firstStartSeconds = startHour! * 3_600 + startMinute! * 60;
  const starts = program.intervalSeconds < daySeconds
    ? Array.from(
        { length: daySeconds / program.intervalSeconds },
        (_, index) => (firstStartSeconds + index * program.intervalSeconds) % daySeconds,
      ).sort((left, right) => left - right)
    : [firstStartSeconds];

  return starts.map((startSeconds) => {
    const start = new Date(base.getTime() + startSeconds * 1_000);
    return {
      key: `${date}T${String(Math.floor(startSeconds / 3_600)).padStart(2, "0")}:${String(Math.floor(startSeconds / 60) % 60).padStart(2, "0")}`,
      start,
      end: new Date(start.getTime() + program.durationSeconds * 1_000),
    };
  });
}

function near(now: Date, target: Date): boolean {
  const elapsed = now.getTime() - target.getTime();
  return elapsed >= 0 && elapsed < eventWindowMilliseconds;
}

function programmedDose(equipment: Equipment): string {
  const amount = equipment.intervalProgram?.doseMilliliters;
  return amount === undefined ? "Programmed amount unavailable" : `Programmed dose: ${amount} mL`;
}

export function trackMd44ScheduledDoses(
  previous: Md44DoseTrackerState,
  equipmentItems: readonly Equipment[],
  now = new Date(),
): Md44DoseTrackerResult {
  const state = structuredClone(previous);
  const transitions: Md44DoseTransition[] = [];
  let changed = false;
  const date = localDate(now);

  for (const equipment of equipmentItems) {
    const program = equipment.intervalProgram;
    if (!program) continue;

    const fingerprint = programFingerprint(equipment);
    let tracked = state[equipment.id];
    if (!tracked || tracked.fingerprint !== fingerprint) {
      tracked = { fingerprint, anchorLocalDate: date };
      state[equipment.id] = tracked;
      changed = true;
    }

    const dayInterval = program.intervalSeconds >= daySeconds
      ? program.intervalSeconds / daySeconds
      : 1;
    const activeDay = Number.isInteger(dayInterval) &&
      (localDateOrdinal(date) - localDateOrdinal(tracked.anchorLocalDate)) % dayInterval === 0;
    if (!program.enabled || equipment.connectionStatus !== "online" || !activeDay) continue;

    for (const occurrence of doseSlots(equipment, date)) {
      if (near(now, occurrence.start) && tracked.lastStartedOccurrence !== occurrence.key) {
        tracked.lastStartedOccurrence = occurrence.key;
        changed = true;
        transitions.push({
          equipmentId: equipment.id,
          action: "scheduled-dose-started",
          title: `${equipment.name} scheduled dose started`,
          details: `${programmedDose(equipment)} · Native MD-4.4 schedule; motor operation is not reported by the device`,
        });
      }
      if (near(now, occurrence.end) && tracked.lastCompletedOccurrence !== occurrence.key) {
        tracked.lastCompletedOccurrence = occurrence.key;
        changed = true;
        transitions.push({
          equipmentId: equipment.id,
          action: "scheduled-dose-completed",
          title: `${equipment.name} scheduled dose completed`,
          details: `${programmedDose(equipment)} · Scheduled runtime: ${program.durationSeconds} seconds · Completion is calculated, not physically confirmed`,
        });
      }
    }
  }

  return { state, transitions, changed };
}
