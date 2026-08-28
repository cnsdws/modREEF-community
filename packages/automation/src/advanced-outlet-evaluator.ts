import type {
  AdvancedOutletCondition,
  AdvancedOutletPowerState,
  AdvancedOutletProgram,
} from "@modreef/digital-twin";

export interface AdvancedOutletEvaluationClock {
  /** Current instant, used for measurement freshness. */
  now: string;
  /** Local controller weekday, where Sunday is 0. */
  weekday: number;
  /** Local controller time in 24-hour HH:MM:SS form. */
  time: string;
}

export interface AdvancedOutletMeasurementSnapshot {
  value: number;
  unit: string;
  measuredAt: string;
}

export interface AdvancedOutletEquipmentSnapshot {
  powerState?: AdvancedOutletPowerState;
  connectivity?: "online" | "offline";
}

export interface AdvancedOutletEvaluationInputs {
  clock: AdvancedOutletEvaluationClock;
  feedCycles: Record<"A" | "B" | "C", boolean>;
  waterChangeActive: boolean;
  measurements: Record<string, AdvancedOutletMeasurementSnapshot | undefined>;
  equipment: Record<string, AdvancedOutletEquipmentSnapshot | undefined>;
}

export type AdvancedOutletRuleOutcome =
  | "matched"
  | "not-matched"
  | "unavailable"
  | "disabled";

export interface AdvancedOutletRuleTrace {
  ruleId: string;
  ruleName: string;
  outcome: AdvancedOutletRuleOutcome;
  explanation: string;
  proposedStateBefore: AdvancedOutletPowerState;
  proposedStateAfter: AdvancedOutletPowerState;
}

export interface AdvancedOutletEvaluationResult {
  status: "evaluated" | "disabled" | "missing-input";
  desiredState: AdvancedOutletPowerState | null;
  defaultState: AdvancedOutletPowerState;
  matchedRuleId?: string;
  missingInputs: string[];
  trace: AdvancedOutletRuleTrace[];
}

interface ConditionResult {
  value: boolean | null;
  explanation: string;
  missingInputs: string[];
}

function clockSeconds(time: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(time);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function rangeSeconds(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 3600 + minutes! * 60;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function combineConditions(
  mode: "all" | "any",
  results: ConditionResult[],
): ConditionResult {
  const missingInputs = unique(results.flatMap((result) => result.missingInputs));
  if (missingInputs.length > 0) {
    return {
      value: null,
      explanation: `${mode === "all" ? "All" : "Any"} group has unavailable input: ${missingInputs.join(", ")}.`,
      missingInputs,
    };
  }
  const value = mode === "all"
    ? results.every((result) => result.value === true)
    : results.some((result) => result.value === true);
  return {
    value,
    explanation: `${mode === "all" ? "All" : "Any"} conditions ${value ? "matched" : "did not match"}.`,
    missingInputs: [],
  };
}

function evaluateCondition(
  condition: AdvancedOutletCondition,
  inputs: AdvancedOutletEvaluationInputs,
): ConditionResult {
  if (condition.type === "all" || condition.type === "any") {
    return combineConditions(
      condition.type,
      condition.conditions.map((item) => evaluateCondition(item, inputs)),
    );
  }
  if (condition.type === "not") {
    const nested = evaluateCondition(condition.condition, inputs);
    return nested.value === null
      ? nested
      : {
          value: !nested.value,
          explanation: `NOT condition ${!nested.value ? "matched" : "did not match"}.`,
          missingInputs: [],
        };
  }
  if (condition.type === "time-range") {
    const now = clockSeconds(inputs.clock.time);
    if (now === undefined || !Number.isInteger(inputs.clock.weekday) ||
      inputs.clock.weekday < 0 || inputs.clock.weekday > 6) {
      return { value: null, explanation: "Controller clock is unavailable.", missingInputs: ["clock"] };
    }
    const start = rangeSeconds(condition.startTime);
    const end = rangeSeconds(condition.endTime);
    const inRange = start <= end ? now >= start && now < end : now >= start || now < end;
    const value = condition.weekdays.includes(inputs.clock.weekday) && inRange;
    return { value, explanation: `Local time ${value ? "is" : "is not"} in the configured range.`, missingInputs: [] };
  }
  if (condition.type === "feed-cycle") {
    const value = inputs.feedCycles[condition.cycle] === condition.active;
    return { value, explanation: `Feed Cycle ${condition.cycle} is ${inputs.feedCycles[condition.cycle] ? "active" : "inactive"}.`, missingInputs: [] };
  }
  if (condition.type === "water-change") {
    const value = inputs.waterChangeActive === condition.active;
    return { value, explanation: `Water Change is ${inputs.waterChangeActive ? "active" : "inactive"}.`, missingInputs: [] };
  }
  if (condition.type === "measurement" || condition.type === "measurement-stale") {
    const measurement = inputs.measurements[condition.measurementId];
    const inputName = `measurement:${condition.measurementId}`;
    if (!measurement) return { value: null, explanation: `${inputName} is unavailable.`, missingInputs: [inputName] };
    const measuredAt = Date.parse(measurement.measuredAt);
    const now = Date.parse(inputs.clock.now);
    if (!Number.isFinite(measuredAt) || !Number.isFinite(now)) {
      return { value: null, explanation: `${inputName} has an invalid timestamp.`, missingInputs: [inputName] };
    }
    if (condition.type === "measurement-stale") {
      const ageSeconds = Math.max(0, (now - measuredAt) / 1000);
      const value = ageSeconds > condition.staleAfterSeconds;
      return { value, explanation: `${inputName} is ${value ? "stale" : "current"} (${Math.floor(ageSeconds)} seconds old).`, missingInputs: [] };
    }
    if (measurement.unit !== condition.unit || !Number.isFinite(measurement.value)) {
      return { value: null, explanation: `${inputName} is unavailable in ${condition.unit}.`, missingInputs: [inputName] };
    }
    const value = condition.comparison === "lt"
      ? measurement.value < condition.value
      : condition.comparison === "lte"
        ? measurement.value <= condition.value
        : condition.comparison === "gt"
          ? measurement.value > condition.value
          : measurement.value >= condition.value;
    return { value, explanation: `${measurement.value} ${measurement.unit} ${value ? "matches" : "does not match"} the threshold.`, missingInputs: [] };
  }
  if (condition.type === "equipment-state" || condition.type === "equipment-connectivity") {
    const equipment = inputs.equipment[condition.equipmentId];
    const inputName = `equipment:${condition.equipmentId}`;
    const actual = condition.type === "equipment-state"
      ? equipment?.powerState
      : equipment?.connectivity;
    if (!actual) return { value: null, explanation: `${inputName} state is unavailable.`, missingInputs: [inputName] };
    const value = actual === condition.state;
    return { value, explanation: `${inputName} is ${actual}.`, missingInputs: [] };
  }
  const now = clockSeconds(inputs.clock.time);
  if (now === undefined) return { value: null, explanation: "Controller clock is unavailable.", missingInputs: ["clock"] };
  if (now < condition.offsetSeconds) {
    return { value: false, explanation: "Oscillation has not reached its daily start offset.", missingInputs: [] };
  }
  const position = (now - condition.offsetSeconds) % (condition.onSeconds + condition.offSeconds);
  const value = position < condition.onSeconds;
  return { value, explanation: `Oscillation is in its ${value ? "ON" : "OFF"} phase.`, missingInputs: [] };
}

/**
 * Evaluates an immutable input snapshot. State-transition protections such as
 * Defer and Min Time are intentionally applied by the next, stateful layer.
 */
export function evaluateAdvancedOutletProgram(
  program: AdvancedOutletProgram,
  inputs: AdvancedOutletEvaluationInputs,
): AdvancedOutletEvaluationResult {
  if (!program.enabled) {
    return {
      status: "disabled",
      desiredState: null,
      defaultState: program.defaultState,
      missingInputs: [],
      trace: [],
    };
  }

  let proposedState = program.defaultState;
  let matchedRuleId: string | undefined;
  const missingInputs: string[] = [];
  const trace: AdvancedOutletRuleTrace[] = [];

  for (const rule of program.rules) {
    const before = proposedState;
    if (!rule.enabled) {
      trace.push({
        ruleId: rule.id,
        ruleName: rule.name,
        outcome: "disabled",
        explanation: "Rule is disabled.",
        proposedStateBefore: before,
        proposedStateAfter: proposedState,
      });
      continue;
    }
    const result = evaluateCondition(rule.condition, inputs);
    missingInputs.push(...result.missingInputs);
    if (result.value === true) {
      proposedState = rule.action.state;
      matchedRuleId = rule.id;
    }
    trace.push({
      ruleId: rule.id,
      ruleName: rule.name,
      outcome: result.value === null ? "unavailable" : result.value ? "matched" : "not-matched",
      explanation: result.explanation,
      proposedStateBefore: before,
      proposedStateAfter: proposedState,
    });
  }

  const uniqueMissingInputs = unique(missingInputs);
  if (uniqueMissingInputs.length > 0) {
    return {
      status: "missing-input",
      desiredState: program.safety.missingInputState,
      defaultState: program.defaultState,
      missingInputs: uniqueMissingInputs,
      trace,
    };
  }
  return {
    status: "evaluated",
    desiredState: proposedState,
    defaultState: program.defaultState,
    ...(matchedRuleId ? { matchedRuleId } : {}),
    missingInputs: [],
    trace,
  };
}
