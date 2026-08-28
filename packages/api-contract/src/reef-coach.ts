import type {
  Aquarium,
  Equipment,
  WaterMeasurement,
  WaterParameter,
} from "@modreef/digital-twin";
import { isMeasurementEquipment } from "@modreef/digital-twin";

export const reefSnapshotSchemaVersion = "1" as const;
export const coachRecommendationSchemaVersion = "1" as const;

export type CoachConfidence = "low" | "medium" | "high";
export type CoachSeverity = "info" | "watch" | "warning" | "critical";
export type CoachWaterParameter = "temperature" | "ph" | "orp" | "salinity";

export interface ReefSnapshotMetric {
  parameter: CoachWaterParameter;
  current: number;
  unit: string;
  measuredAt: string;
  ageMinutes: number;
  minimum24Hours: number;
  maximum24Hours: number;
  change24Hours: number;
  variability24Hours: number;
  calibrated: boolean;
  stable: boolean | null;
  confidence: CoachConfidence;
  evidenceId: string;
}

export interface ReefSnapshot {
  schemaVersion: typeof reefSnapshotSchemaVersion;
  aquarium: { id: string; name: string };
  observedAt: string;
  waterQuality: Partial<Record<CoachWaterParameter, ReefSnapshotMetric>>;
  equipment: {
    total: number;
    online: number;
    needsAttention: number;
  };
  recentEvents: Array<{
    id: string;
    title: string;
    occurredAt: string;
    category?: string;
    evidenceId: string;
  }>;
  missingInformation: string[];
}

export interface CoachRecommendation {
  schemaVersion: typeof coachRecommendationSchemaVersion;
  generatedAt: string;
  summary: string;
  severity: CoachSeverity;
  confidence: CoachConfidence;
  observations: Array<{ statement: string; evidenceIds: string[] }>;
  hypotheses: Array<{ explanation: string; confidence: CoachConfidence }>;
  recommendations: Array<{
    action: string;
    reason: string;
    requiresConfirmation: boolean;
  }>;
  missingInformation: string[];
  suggestedFollowUpAt?: string;
}

export interface ReefCoachReport {
  snapshot: ReefSnapshot;
  recommendation: CoachRecommendation;
  generation?: {
    mode: "deterministic" | "model";
    provider?: "openai";
    model?: string;
    fallbackReason?: string;
  };
}

export const coachRecommendationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: [coachRecommendationSchemaVersion] },
    generatedAt: { type: "string" },
    summary: { type: "string" },
    severity: { type: "string", enum: ["info", "watch", "warning", "critical"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    observations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          statement: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["statement", "evidenceIds"],
      },
    },
    hypotheses: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          explanation: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["explanation", "confidence"],
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          action: { type: "string" }, reason: { type: "string" },
          requiresConfirmation: { type: "boolean" },
        },
        required: ["action", "reason", "requiresConfirmation"],
      },
    },
    missingInformation: { type: "array", items: { type: "string" } },
    suggestedFollowUpAt: { type: ["string", "null"] },
  },
  required: ["schemaVersion", "generatedAt", "summary", "severity", "confidence", "observations", "hypotheses", "recommendations", "missingInformation", "suggestedFollowUpAt"],
} as const;

export function isCoachRecommendation(value: unknown): value is CoachRecommendation {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const confidence = (entry: unknown) => entry === "low" || entry === "medium" || entry === "high";
  const strings = (entry: unknown) => Array.isArray(entry) && entry.every((part) => typeof part === "string");
  return item.schemaVersion === coachRecommendationSchemaVersion &&
    typeof item.generatedAt === "string" && Number.isFinite(Date.parse(item.generatedAt)) &&
    typeof item.summary === "string" && item.summary.length > 0 &&
    (item.severity === "info" || item.severity === "watch" || item.severity === "warning" || item.severity === "critical") &&
    confidence(item.confidence) &&
    Array.isArray(item.observations) && item.observations.every((entry) => {
      const observation = entry as Record<string, unknown>;
      return typeof observation?.statement === "string" && strings(observation.evidenceIds);
    }) &&
    Array.isArray(item.hypotheses) && item.hypotheses.every((entry) => {
      const hypothesis = entry as Record<string, unknown>;
      return typeof hypothesis?.explanation === "string" && confidence(hypothesis.confidence);
    }) &&
    Array.isArray(item.recommendations) && item.recommendations.every((entry) => {
      const recommendation = entry as Record<string, unknown>;
      return typeof recommendation?.action === "string" && typeof recommendation.reason === "string" &&
        typeof recommendation.requiresConfirmation === "boolean";
    }) && strings(item.missingInformation) &&
    (item.suggestedFollowUpAt === undefined || item.suggestedFollowUpAt === null ||
      (typeof item.suggestedFollowUpAt === "string" && Number.isFinite(Date.parse(item.suggestedFollowUpAt))));
}

const coachParameters: CoachWaterParameter[] = ["temperature", "ph", "orp", "salinity"];

function isEquipment(value: unknown): value is Equipment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" &&
    typeof item.role === "string";
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function metricConfidence(
  ageMinutes: number,
  calibrated: boolean,
  stable: boolean | null,
): CoachConfidence {
  if (ageMinutes > 10 || stable === false) return "low";
  if (ageMinutes > 3 || !calibrated || stable === null) return "medium";
  return "high";
}

function metricFromSensor(
  sensor: Equipment,
  parameter: CoachWaterParameter,
  observedAt: string,
): ReefSnapshotMetric | undefined {
  const cutoff = Date.parse(observedAt) - 86_400_000;
  const all = [
    ...(sensor.measurementHistory ?? []),
    ...(sensor.liveMeasurements ?? []),
  ].filter((measurement) => measurement.parameter === parameter &&
    Date.parse(measurement.measuredAt) >= cutoff)
    .sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt));
  const latest = all.at(-1);
  if (!latest) return undefined;
  const values = all.map(({ value }) => value);
  const current = latest.value;
  const calibration = sensor.waterProbeCalibration?.[parameter];
  const stable = sensor.waterMeasurementStability?.[parameter]?.stable ?? null;
  const ageMinutes = Math.max(0, (Date.parse(observedAt) - Date.parse(latest.measuredAt)) / 60_000);
  return {
    parameter,
    current,
    unit: latest.unit,
    measuredAt: latest.measuredAt,
    ageMinutes: rounded(ageMinutes),
    minimum24Hours: rounded(Math.min(...values)),
    maximum24Hours: rounded(Math.max(...values)),
    change24Hours: rounded(current - all[0]!.value),
    variability24Hours: rounded(Math.max(...values) - Math.min(...values)),
    calibrated: calibration !== undefined,
    stable,
    confidence: metricConfidence(ageMinutes, calibration !== undefined, stable),
    evidenceId: `measurement:${sensor.id}:${parameter}:${latest.measuredAt}`,
  };
}

function normalizeEvent(value: unknown): {
  id: string;
  title: string;
  occurredAt: string;
  category?: string;
} | undefined {
  const document = value && typeof value === "object" && "document" in value
    ? (value as { document: unknown }).document
    : value;
  if (!document || typeof document !== "object") return undefined;
  const event = document as Record<string, unknown>;
  if (typeof event.id !== "string" || typeof event.occurredAt !== "string" ||
    typeof event.title !== "string") return undefined;
  return {
    id: event.id,
    title: event.title,
    occurredAt: event.occurredAt,
    ...(typeof event.category === "string" ? { category: event.category } : {}),
  };
}

export function buildReefSnapshot(input: {
  aquarium: Pick<Aquarium, "id" | "name">;
  equipment: unknown[];
  events?: unknown[];
  observedAt?: string;
}): ReefSnapshot {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const equipment = input.equipment.filter(isEquipment);
  const sensor = equipment.find(isMeasurementEquipment);
  const waterQuality = Object.fromEntries(sensor ? coachParameters.flatMap((parameter) => {
    const metric = metricFromSensor(sensor, parameter, observedAt);
    return metric ? [[parameter, metric]] : [];
  }) : []) as ReefSnapshot["waterQuality"];
  const recentEvents = (input.events ?? []).flatMap((value) => {
    const event = normalizeEvent(value);
    return event ? [{
      id: event.id,
      title: event.title,
      occurredAt: event.occurredAt,
      ...(event.category ? { category: event.category } : {}),
      evidenceId: `event:${event.id}`,
    }] : [];
  }).filter(({ occurredAt }) => Date.parse(occurredAt) >= Date.parse(observedAt) - 86_400_000)
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 20);
  const missingInformation = coachParameters.flatMap((parameter) =>
    waterQuality[parameter] ? [] : [`No current ${parameter} reading.`]
  );
  for (const metric of Object.values(waterQuality)) {
    if (!metric.calibrated) missingInformation.push(`${metric.parameter} probe is not calibrated.`);
    if (metric.ageMinutes > 10) missingInformation.push(`${metric.parameter} reading is stale.`);
  }
  return {
    schemaVersion: reefSnapshotSchemaVersion,
    aquarium: { id: input.aquarium.id, name: input.aquarium.name },
    observedAt,
    waterQuality,
    equipment: {
      total: equipment.filter((item) => !isMeasurementEquipment(item)).length,
      online: equipment.filter((item) =>
        !isMeasurementEquipment(item) && item.connectionStatus === "online"
      ).length,
      needsAttention: equipment.filter(({ connectionStatus, healthStatus }) =>
        connectionStatus !== "online" || healthStatus !== "normal"
      ).length,
    },
    recentEvents,
    missingInformation,
  };
}

export function buildObserverRecommendation(snapshot: ReefSnapshot): CoachRecommendation {
  const metrics = Object.values(snapshot.waterQuality);
  const lowConfidence = metrics.filter(({ confidence }) => confidence === "low");
  const moving = metrics.filter(({ stable }) => stable === false);
  const observations = metrics.map((metric) => ({
    statement: `${label(metric.parameter)} is ${metric.current}${metric.unit ? ` ${metric.unit}` : ""}; its 24-hour range is ${metric.minimum24Hours}–${metric.maximum24Hours}${metric.unit ? ` ${metric.unit}` : ""}.`,
    evidenceIds: [metric.evidenceId],
  }));
  const recommendations: CoachRecommendation["recommendations"] = [];
  if (lowConfidence.length > 0) recommendations.push({
    action: "Inspect the affected probe and confirm its connection and calibration.",
    reason: `${lowConfidence.map(({ parameter }) => label(parameter)).join(", ")} has low-confidence data.`,
    requiresConfirmation: false,
  });
  if (moving.length > 0) recommendations.push({
    action: "Allow the readings to stabilize before calibrating or changing aquarium chemistry.",
    reason: `${moving.map(({ parameter }) => label(parameter)).join(", ")} is still varying beyond its stability limit.`,
    requiresConfirmation: false,
  });
  if (snapshot.equipment.needsAttention > 0) recommendations.push({
    action: "Review the active equipment alert before making husbandry changes.",
    reason: `${snapshot.equipment.needsAttention} equipment item${snapshot.equipment.needsAttention === 1 ? "" : "s"} needs attention.`,
    requiresConfirmation: false,
  });
  const severity: CoachSeverity = snapshot.equipment.needsAttention > 0 || lowConfidence.length > 0
    ? "warning" : moving.length > 0 || snapshot.missingInformation.length > 0 ? "watch" : "info";
  const confidence: CoachConfidence = lowConfidence.length > 0 || metrics.length < 2
    ? "low" : metrics.some((metric) => metric.confidence === "medium") ? "medium" : "high";
  const summary = metrics.length === 0
    ? "Reef Coach is waiting for water-quality data."
    : severity === "info"
      ? "Available water-quality readings are current and stable."
      : severity === "watch"
        ? "Water quality is being monitored, but more stable or complete data is needed."
        : "One or more readings or equipment states need review.";
  return {
    schemaVersion: coachRecommendationSchemaVersion,
    generatedAt: snapshot.observedAt,
    summary,
    severity,
    confidence,
    observations,
    hypotheses: [],
    recommendations,
    missingInformation: snapshot.missingInformation,
    suggestedFollowUpAt: new Date(Date.parse(snapshot.observedAt) + 60 * 60_000).toISOString(),
  };
}

export function buildReefCoachReport(input: Parameters<typeof buildReefSnapshot>[0]): ReefCoachReport {
  const snapshot = buildReefSnapshot(input);
  return { snapshot, recommendation: buildObserverRecommendation(snapshot) };
}

function label(parameter: WaterParameter): string {
  return parameter === "ph" ? "pH" : parameter === "orp" ? "ORP" :
    parameter.charAt(0).toUpperCase() + parameter.slice(1);
}
