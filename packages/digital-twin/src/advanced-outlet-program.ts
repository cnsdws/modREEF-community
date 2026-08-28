import type { Identifier, IsoDateTime } from "@modreef/foundation";

export const advancedOutletProgramSchema = "modreef.advanced-outlet-program" as const;
export const advancedOutletProgramVersion = 1 as const;

export type AdvancedOutletPowerState = "on" | "off";
export type AdvancedOutletComparison = "lt" | "lte" | "gt" | "gte";
export type AdvancedOutletFeedCycle = "A" | "B" | "C";

export interface AdvancedOutletAllCondition {
  type: "all";
  conditions: AdvancedOutletCondition[];
}

export interface AdvancedOutletAnyCondition {
  type: "any";
  conditions: AdvancedOutletCondition[];
}

export interface AdvancedOutletNotCondition {
  type: "not";
  condition: AdvancedOutletCondition;
}

export interface AdvancedOutletTimeCondition {
  type: "time-range";
  startTime: string;
  endTime: string;
  /** Sunday is 0 and Saturday is 6. */
  weekdays: number[];
}

export interface AdvancedOutletFeedCycleCondition {
  type: "feed-cycle";
  cycle: AdvancedOutletFeedCycle;
  active: boolean;
}

export interface AdvancedOutletWaterChangeCondition {
  type: "water-change";
  active: boolean;
}

export interface AdvancedOutletMeasurementCondition {
  type: "measurement";
  measurementId: Identifier;
  comparison: AdvancedOutletComparison;
  value: number;
  unit: string;
}

export interface AdvancedOutletMeasurementStaleCondition {
  type: "measurement-stale";
  measurementId: Identifier;
  staleAfterSeconds: number;
}

export interface AdvancedOutletEquipmentStateCondition {
  type: "equipment-state";
  equipmentId: Identifier;
  state: AdvancedOutletPowerState;
}

export interface AdvancedOutletEquipmentConnectivityCondition {
  type: "equipment-connectivity";
  equipmentId: Identifier;
  state: "online" | "offline";
}

export interface AdvancedOutletOscillationCondition {
  type: "oscillation";
  /** Offset from local midnight before the first ON period. */
  offsetSeconds: number;
  onSeconds: number;
  offSeconds: number;
}

export type AdvancedOutletCondition =
  | AdvancedOutletAllCondition
  | AdvancedOutletAnyCondition
  | AdvancedOutletNotCondition
  | AdvancedOutletTimeCondition
  | AdvancedOutletFeedCycleCondition
  | AdvancedOutletWaterChangeCondition
  | AdvancedOutletMeasurementCondition
  | AdvancedOutletMeasurementStaleCondition
  | AdvancedOutletEquipmentStateCondition
  | AdvancedOutletEquipmentConnectivityCondition
  | AdvancedOutletOscillationCondition;

export interface AdvancedOutletSetPowerAction {
  type: "set-power";
  state: AdvancedOutletPowerState;
}

export type AdvancedOutletAction = AdvancedOutletSetPowerAction;

export interface AdvancedOutletRule {
  id: Identifier;
  name: string;
  enabled: boolean;
  condition: AdvancedOutletCondition;
  action: AdvancedOutletAction;
}

export interface AdvancedOutletSafetyPolicy {
  /** Desired state when any input required by an enabled rule is unavailable. */
  missingInputState: AdvancedOutletPowerState;
  deferOnSeconds: number;
  deferOffSeconds: number;
  minimumOnSeconds: number;
  minimumOffSeconds: number;
  maximumContinuousOnSeconds?: number;
  maximumDailyRuntimeSeconds?: number;
  maximumTransitionsPerHour?: number;
}

/**
 * Portable source-of-truth for visual and text advanced-outlet editors.
 * Rules are evaluated in array order; the last matching enabled rule wins.
 */
export interface AdvancedOutletProgramV1 {
  schema: typeof advancedOutletProgramSchema;
  version: typeof advancedOutletProgramVersion;
  id: Identifier;
  revision: number;
  name: string;
  enabled: boolean;
  defaultState: AdvancedOutletPowerState;
  fallbackState: AdvancedOutletPowerState;
  rules: AdvancedOutletRule[];
  safety: AdvancedOutletSafetyPolicy;
  /** User-authored text used by the compact Advanced Outlet editor. */
  sourceText?: string;
  updatedAt: IsoDateTime;
}

export type AdvancedOutletProgram = AdvancedOutletProgramV1;

export interface AdvancedOutletProgramIssue {
  path: string;
  message: string;
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validateCondition(
  value: unknown,
  path: string,
  issues: AdvancedOutletProgramIssue[],
  depth = 0,
): void {
  if (!isObject(value) || typeof value.type !== "string") {
    issues.push({ path, message: "Condition must be an object with a supported type." });
    return;
  }
  if (depth > 10) {
    issues.push({ path, message: "Condition nesting cannot exceed 10 levels." });
    return;
  }

  if (value.type === "all" || value.type === "any") {
    if (!Array.isArray(value.conditions) || value.conditions.length === 0) {
      issues.push({ path: `${path}.conditions`, message: "Choose at least one condition." });
      return;
    }
    value.conditions.forEach((condition, index) =>
      validateCondition(condition, `${path}.conditions[${index}]`, issues, depth + 1));
    return;
  }
  if (value.type === "not") {
    validateCondition(value.condition, `${path}.condition`, issues, depth + 1);
    return;
  }
  if (value.type === "time-range") {
    if (typeof value.startTime !== "string" || !timePattern.test(value.startTime)) {
      issues.push({ path: `${path}.startTime`, message: "Use a 24-hour HH:MM time." });
    }
    if (typeof value.endTime !== "string" || !timePattern.test(value.endTime)) {
      issues.push({ path: `${path}.endTime`, message: "Use a 24-hour HH:MM time." });
    }
    if (!Array.isArray(value.weekdays) || value.weekdays.length === 0 ||
      value.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      issues.push({ path: `${path}.weekdays`, message: "Choose weekdays numbered 0 through 6." });
    }
    return;
  }
  if (value.type === "feed-cycle") {
    if (!(["A", "B", "C"] as unknown[]).includes(value.cycle) || typeof value.active !== "boolean") {
      issues.push({ path, message: "Feed-cycle conditions require cycle A, B, or C and an active state." });
    }
    return;
  }
  if (value.type === "water-change") {
    if (typeof value.active !== "boolean") issues.push({ path: `${path}.active`, message: "Active must be true or false." });
    return;
  }
  if (value.type === "measurement") {
    if (!isNonEmptyString(value.measurementId) ||
      !(["lt", "lte", "gt", "gte"] as unknown[]).includes(value.comparison) ||
      typeof value.value !== "number" || !Number.isFinite(value.value) ||
      !isNonEmptyString(value.unit)) {
      issues.push({ path, message: "Measurement conditions require an ID, comparison, finite value, and unit." });
    }
    return;
  }
  if (value.type === "measurement-stale") {
    if (!isNonEmptyString(value.measurementId) || !isNonNegativeInteger(value.staleAfterSeconds) || value.staleAfterSeconds === 0) {
      issues.push({ path, message: "Stale measurement conditions require an ID and positive duration." });
    }
    return;
  }
  if (value.type === "equipment-state" || value.type === "equipment-connectivity") {
    const states = value.type === "equipment-state" ? ["on", "off"] : ["online", "offline"];
    if (!isNonEmptyString(value.equipmentId) || !states.includes(String(value.state))) {
      issues.push({ path, message: "Equipment conditions require an equipment ID and supported state." });
    }
    return;
  }
  if (value.type === "oscillation") {
    if (!isNonNegativeInteger(value.offsetSeconds) || !isNonNegativeInteger(value.onSeconds) ||
      value.onSeconds === 0 || !isNonNegativeInteger(value.offSeconds) || value.offSeconds === 0) {
      issues.push({ path, message: "Oscillation requires a non-negative offset and positive ON/OFF durations." });
    }
    return;
  }
  issues.push({ path: `${path}.type`, message: `Unsupported condition type: ${value.type}` });
}

export function validateAdvancedOutletProgram(
  value: unknown,
): AdvancedOutletProgramIssue[] {
  const issues: AdvancedOutletProgramIssue[] = [];
  if (!isObject(value)) return [{ path: "$", message: "Program must be an object." }];
  if (value.schema !== advancedOutletProgramSchema) issues.push({ path: "$.schema", message: "Unsupported program schema." });
  if (value.version !== advancedOutletProgramVersion) issues.push({ path: "$.version", message: "Unsupported program version." });
  if (!isNonEmptyString(value.id)) issues.push({ path: "$.id", message: "Program ID is required." });
  if (!isNonNegativeInteger(value.revision) || value.revision === 0) issues.push({ path: "$.revision", message: "Revision must be a positive integer." });
  if (!isNonEmptyString(value.name)) issues.push({ path: "$.name", message: "Program name is required." });
  if (typeof value.enabled !== "boolean") issues.push({ path: "$.enabled", message: "Enabled must be true or false." });
  if (value.defaultState !== "on" && value.defaultState !== "off") issues.push({ path: "$.defaultState", message: "Default state must be on or off." });
  if (value.fallbackState !== "on" && value.fallbackState !== "off") issues.push({ path: "$.fallbackState", message: "Fallback state must be on or off." });
  if (!isNonEmptyString(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt))) issues.push({ path: "$.updatedAt", message: "Updated time must be an ISO date-time." });
  if (value.sourceText !== undefined && typeof value.sourceText !== "string") {
    issues.push({ path: "$.sourceText", message: "Program source must be text." });
  }

  if (!Array.isArray(value.rules)) {
    issues.push({ path: "$.rules", message: "Rules must be an ordered array." });
  } else {
    const ids = new Set<string>();
    value.rules.forEach((rule, index) => {
      const path = `$.rules[${index}]`;
      if (!isObject(rule)) {
        issues.push({ path, message: "Rule must be an object." });
        return;
      }
      if (!isNonEmptyString(rule.id)) issues.push({ path: `${path}.id`, message: "Rule ID is required." });
      else if (ids.has(rule.id)) issues.push({ path: `${path}.id`, message: "Rule IDs must be unique." });
      else ids.add(rule.id);
      if (!isNonEmptyString(rule.name)) issues.push({ path: `${path}.name`, message: "Rule name is required." });
      if (typeof rule.enabled !== "boolean") issues.push({ path: `${path}.enabled`, message: "Enabled must be true or false." });
      validateCondition(rule.condition, `${path}.condition`, issues);
      if (!isObject(rule.action) || rule.action.type !== "set-power" ||
        (rule.action.state !== "on" && rule.action.state !== "off")) {
        issues.push({ path: `${path}.action`, message: "Rule action must set outlet power on or off." });
      }
    });
  }

  if (!isObject(value.safety)) {
    issues.push({ path: "$.safety", message: "Safety policy is required." });
  } else {
    if (value.safety.missingInputState !== "on" && value.safety.missingInputState !== "off") {
      issues.push({ path: "$.safety.missingInputState", message: "Missing-input state must be on or off." });
    }
    for (const field of ["deferOnSeconds", "deferOffSeconds", "minimumOnSeconds", "minimumOffSeconds"] as const) {
      if (!isNonNegativeInteger(value.safety[field])) issues.push({ path: `$.safety.${field}`, message: "Duration must be a non-negative integer." });
    }
    for (const field of ["maximumContinuousOnSeconds", "maximumDailyRuntimeSeconds", "maximumTransitionsPerHour"] as const) {
      const candidate = value.safety[field];
      if (candidate !== undefined && (!isNonNegativeInteger(candidate) || candidate === 0)) {
        issues.push({ path: `$.safety.${field}`, message: "Limit must be a positive integer when provided." });
      }
    }
  }
  return issues;
}

export function isAdvancedOutletProgram(value: unknown): value is AdvancedOutletProgram {
  return validateAdvancedOutletProgram(value).length === 0;
}
