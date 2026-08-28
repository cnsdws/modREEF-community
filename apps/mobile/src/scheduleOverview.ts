import type { Equipment } from "@modreef/digital-twin";

export interface ScheduleTimelineItem {
  id: string;
  equipmentId: string;
  equipmentName: string;
  time: string;
  title: string;
  summary: string;
  kind: "power" | "interval";
}

export interface ScheduleRuleSummary {
  id: string;
  equipmentId: string;
  equipmentName: string;
  enabled: boolean;
  kind: "power" | "interval";
  title: string;
  summary: string;
}

export interface MaintenanceTask {
  id: string;
  equipmentId: string;
  equipmentName: string;
  dueAt: string;
  status: "overdue" | "upcoming" | "scheduled";
  title: string;
}

const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDuration(seconds: number): string {
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hr${hours === 1 ? "" : "s"}`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} min`;
  }

  return `${seconds} sec`;
}

export function formatWeekdays(weekdays: number[]): string {
  const unique = [...new Set(weekdays)].sort();

  if (unique.length === 7) {
    return "Every day";
  }

  if (
    unique.length === 5 &&
    unique.every((day, index) => day === index + 1)
  ) {
    return "Weekdays";
  }

  if (unique.length === 2 && unique[0] === 0 && unique[1] === 6) {
    return "Weekends";
  }

  return unique.map((day) => dayLabels[day] ?? String(day)).join(", ");
}

export function getTodayScheduleItems(
  equipment: Equipment[],
  today = new Date(),
): ScheduleTimelineItem[] {
  const weekday = today.getDay();
  const items: ScheduleTimelineItem[] = [];

  for (const item of equipment) {
    if (item.schedule?.enabled) {
      for (const event of item.schedule.events) {
        if (!event.weekdays.includes(weekday)) {
          continue;
        }

        items.push({
          id: `${item.id}:${event.id}`,
          equipmentId: item.id,
          equipmentName: item.name,
          time: event.time,
          title: `${item.name} ${event.desiredEnabled ? "ON" : "OFF"}`,
          summary: "Equipment schedule",
          kind: "power",
        });
      }
    }

    const program = item.intervalProgram;

    if (program?.enabled && program.weekdays.includes(weekday)) {
      const dose = program.doseMilliliters;
      items.push({
        id: `${item.id}:interval-start`,
        equipmentId: item.id,
        equipmentName: item.name,
        time: program.startTime,
        title:
          dose === undefined
            ? `${item.name} interval starts`
            : `${item.name} doses ${dose} mL`,
        summary: `Repeats every ${formatDuration(program.intervalSeconds)}`,
        kind: "interval",
      });
    }
  }

  return items.sort(
    (left, right) =>
      left.time.localeCompare(right.time) ||
      left.title.localeCompare(right.title),
  );
}

export function getScheduleRules(
  equipment: Equipment[],
): ScheduleRuleSummary[] {
  const rules: ScheduleRuleSummary[] = [];

  for (const item of equipment) {
    if (
      (item.programType === "schedule" ||
        item.programType === "light-schedule") &&
      item.schedule &&
      item.schedule.events.length > 0
    ) {
      const on = item.schedule.events.find((event) => event.desiredEnabled);
      const off = item.schedule.events.find((event) => !event.desiredEnabled);
      const weekdays = on?.weekdays ?? off?.weekdays ?? [];

      rules.push({
        id: `${item.id}:schedule`,
        equipmentId: item.id,
        equipmentName: item.name,
        enabled: item.schedule.enabled,
        kind: "power",
        title: `${on?.time ?? "—"} ON · ${off?.time ?? "—"} OFF`,
        summary: formatWeekdays(weekdays),
      });
    }

    const program = item.intervalProgram;

    if (
      program &&
      (item.programType === "dosing-pump" ||
        item.programType === "advanced")
    ) {
      rules.push({
        id: `${item.id}:interval`,
        equipmentId: item.id,
        equipmentName: item.name,
        enabled: program.enabled,
        kind: "interval",
        title:
          program.doseMilliliters === undefined
            ? `Starts ${program.startTime} · every ${formatDuration(program.intervalSeconds)}`
            : `${program.doseMilliliters} mL · every ${formatDuration(program.intervalSeconds)}`,
        summary: `${formatWeekdays(program.weekdays)} · starts ${program.startTime}`,
      });
    }
  }

  return rules.sort((left, right) =>
    left.equipmentName.localeCompare(right.equipmentName),
  );
}

export function getMaintenanceTasks(
  equipment: Equipment[],
  now = new Date(),
): MaintenanceTask[] {
  const upcomingLimit = new Date(now);
  upcomingLimit.setDate(upcomingLimit.getDate() + 30);

  return equipment
    .flatMap((item): MaintenanceTask[] => {
      const dueAt = item.doserCalibration?.dueAt;

      if (!dueAt) {
        return [];
      }

      const due = new Date(dueAt);
      const status =
        due.getTime() < now.getTime()
          ? "overdue"
          : due.getTime() <= upcomingLimit.getTime()
            ? "upcoming"
            : "scheduled";

      return [
        {
          id: `${item.id}:recalibration`,
          equipmentId: item.id,
          equipmentName: item.name,
          dueAt,
          status,
          title: `Recalibrate ${item.name}`,
        },
      ];
    })
    .sort(
      (left, right) =>
        new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
    );
}
