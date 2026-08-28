import type {
  AquariumEvent,
  Equipment,
  WaterMeasurement,
} from "@modreef/digital-twin";
import {
  defaultWaterAlarmRules,
  type WaterAlarmMetric,
  type WaterAlarmRule,
  type WaterAlarmRules,
} from "@modreef/api-contract";

export type DiagnosticSeverity = "warning" | "critical";

export interface DiagnosticIssue {
  id: string;
  title: string;
  summary: string;
  severity: DiagnosticSeverity;
  equipmentId?: string;
}

export interface PersistentWaterIssueState {
  pendingSince: Record<string, number>;
  issues: DiagnosticIssue[];
}

export function requirePersistentWaterIssues(
  issues: DiagnosticIssue[],
  previous: Record<string, number>,
  now = Date.now(),
  persistenceMilliseconds = 120_000,
): PersistentWaterIssueState {
  const currentWaterIds = new Set(
    issues.filter(({ id }) => id.startsWith("water:")).map(({ id }) => id),
  );
  const pendingSince = Object.fromEntries(
    Object.entries(previous).filter(([id]) => currentWaterIds.has(id)),
  );
  const persistent = issues.filter((issue) => {
    if (!issue.id.startsWith("water:")) return true;
    const startedAt = pendingSince[issue.id] ?? now;
    pendingSince[issue.id] = startedAt;
    return now - startedAt >= persistenceMilliseconds;
  });
  return { pendingSince, issues: persistent };
}

export type EdgeAvailability = "unknown" | "online" | "offline";

export type AlertMetric = WaterAlarmMetric;
export type AlertRule = WaterAlarmRule;
export type AlertRules = WaterAlarmRules;

export interface AlertReading {
  measuredAt: string;
  value: number;
}

export type AlertReadings = Partial<Record<AlertMetric, AlertReading>>;

export function acknowledgedAlertsFromEvents(
  events: AquariumEvent[],
): Record<string, string> {
  const acknowledged: Record<string, string> = {};
  const alertIdsByTitle = new Map<string, string>();
  const ordered = [...events].sort(
    (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
  );

  for (const event of ordered) {
    if (
      event.type === "activity" &&
      event.category === "alert" &&
      event.alertId
    ) {
      alertIdsByTitle.set(normalizedAlertTitle(event.title), event.alertId);
    }
  }

  for (const event of ordered) {
    if (
      event.type !== "activity" ||
      event.category !== "alert"
    ) continue;

    const alertId = event.alertId ?? alertIdsByTitle.get(
      normalizedAlertTitle(event.title),
    );
    if (!alertId) continue;

    if (event.action === "acknowledged") {
      acknowledged[alertId] = event.occurredAt;
    } else if (event.action === "resolved") {
      delete acknowledged[alertId];
    }
  }

  return acknowledged;
}

function normalizedAlertTitle(title: string): string {
  return title
    .replace(/^Alert activated:\s*/i, "")
    .replace(/^Acknowledged alert:\s*/i, "")
    .replace(/^Alert resolved:\s*/i, "")
    .trim()
    .toLocaleLowerCase();
}

export const defaultAlertRules: AlertRules = defaultWaterAlarmRules;

const criticalEquipmentRoles = new Set<Equipment["role"]>([
  "heater",
  "return-pump",
  "ato",
]);

export function getDiagnosticIssues(
  equipment: Equipment[],
  edgeAvailability: EdgeAvailability,
  rules: AlertRules = defaultAlertRules,
  readings: AlertReadings = {},
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  if (rules.edgeWatchdogEnabled && edgeAvailability === "offline") {
    issues.push({
      id: "edge:offline",
      title: "Reef Controller unavailable",
      summary:
        "The app cannot reach the Reef Controller. Local automations may still be running, but their status cannot be confirmed.",
      severity: "critical",
    });
  }

  for (const item of rules.equipmentEnabled ? equipment : []) {
    if (item.connectionStatus !== "online") {
      const critical =
        item.enabled && criticalEquipmentRoles.has(item.role);

      issues.push({
        id: `equipment:${item.id}:connection`,
        title: `${item.name} is ${item.connectionStatus}`,
        summary: critical
          ? "A life-support device is unavailable. Confirm power, network connectivity, and physical operation."
          : "Confirm power, network connectivity, and physical operation.",
        severity: critical ? "critical" : "warning",
        equipmentId: item.id,
      });
      continue;
    }

    if (
      item.healthStatus === "attention" ||
      item.healthStatus === "warning" ||
      item.healthStatus === "critical"
    ) {
      issues.push({
        id: `equipment:${item.id}:health`,
        title: `${item.name} needs attention`,
        summary: `Equipment health is reported as ${item.healthStatus}. Open its detail panel and inspect the device.`,
        severity:
          item.healthStatus === "critical" ? "critical" : "warning",
        equipmentId: item.id,
      });
    }
  }

  for (const metric of Object.keys(rules.metrics) as AlertMetric[]) {
    const rule = rules.metrics[metric];
    const reading = readings[metric];

    if (
      !rule.enabled ||
      !reading ||
      !Number.isFinite(reading.value) ||
      reading.value >= rule.lower &&
        reading.value <= rule.upper
    ) {
      continue;
    }

    const direction = reading.value < rule.lower ? "low" : "high";

    issues.push({
      id: `water:${metric}:${direction}`,
      title: `${rule.label} is ${direction}`,
      summary: `${reading.value}${rule.unit ? ` ${rule.unit}` : ""} is outside the configured ${rule.lower}–${rule.upper}${rule.unit ? ` ${rule.unit}` : ""} range.`,
      severity: metric === "temperature" ? "critical" : "warning",
    });
  }

  return issues.sort((left, right) => {
    if (left.severity === right.severity) {
      return left.title.localeCompare(right.title);
    }

    return left.severity === "critical" ? -1 : 1;
  });
}

export function alertReadingsFromMeasurements(
  measurements: WaterMeasurement[],
): AlertReadings {
  const readings: AlertReadings = {};

  for (const measurement of [...measurements].sort(
    (left, right) =>
      Date.parse(right.measuredAt) - Date.parse(left.measuredAt),
  )) {
    if (
      (measurement.parameter === "temperature" ||
        measurement.parameter === "ph" ||
        measurement.parameter === "orp" ||
        measurement.parameter === "salinity") &&
      !readings[measurement.parameter]
    ) {
      readings[measurement.parameter] = {
        measuredAt: measurement.measuredAt,
        value: measurement.value,
      };
    }
  }

  return readings;
}
