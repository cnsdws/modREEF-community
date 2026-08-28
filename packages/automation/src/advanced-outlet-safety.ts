import type {
  AdvancedOutletPowerState,
  AdvancedOutletProgram,
} from "@modreef/digital-twin";

import type { AdvancedOutletEvaluationResult } from "./advanced-outlet-evaluator";

export const advancedOutletRuntimeStateVersion = 1 as const;

export interface AdvancedOutletPendingTransition {
  targetState: AdvancedOutletPowerState;
  startedAt: string;
}

/** Serializable state persisted by Edge after every safety evaluation. */
export interface AdvancedOutletRuntimeStateV1 {
  version: typeof advancedOutletRuntimeStateVersion;
  programId: string;
  programRevision: number;
  observedState: AdvancedOutletPowerState;
  observedStateSince: string;
  lastEvaluatedAt: string;
  dailyRuntimeDate: string;
  dailyOnSeconds: number;
  pendingTransition?: AdvancedOutletPendingTransition;
  transitionTimestamps: string[];
}

export type AdvancedOutletRuntimeState = AdvancedOutletRuntimeStateV1;

export type AdvancedOutletSafetyReason =
  | "program-disabled"
  | "already-in-state"
  | "defer-active"
  | "minimum-on-active"
  | "minimum-off-active"
  | "transition-limit-active"
  | "program-request"
  | "missing-input-safety"
  | "maximum-continuous-runtime"
  | "maximum-daily-runtime";

export interface AdvancedOutletSafetyDecision {
  requestedState: AdvancedOutletPowerState | null;
  effectiveDesiredState: AdvancedOutletPowerState | null;
  reason: AdvancedOutletSafetyReason;
  waitSeconds?: number;
  runtimeState: AdvancedOutletRuntimeState;
}

export interface AdvancedOutletSafetyContext {
  now: string;
  /** Controller-local YYYY-MM-DD, supplied to avoid timezone ambiguity. */
  localDate: string;
  observedState: AdvancedOutletPowerState;
}

function epoch(value: string): number {
  return Date.parse(value);
}

function elapsedSeconds(from: string, to: string): number {
  return Math.max(0, (epoch(to) - epoch(from)) / 1000);
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(epoch(value));
}

function initializeRuntimeState(
  program: AdvancedOutletProgram,
  context: AdvancedOutletSafetyContext,
): AdvancedOutletRuntimeState {
  return {
    version: advancedOutletRuntimeStateVersion,
    programId: program.id,
    programRevision: program.revision,
    observedState: context.observedState,
    observedStateSince: context.now,
    lastEvaluatedAt: context.now,
    dailyRuntimeDate: context.localDate,
    dailyOnSeconds: 0,
    transitionTimestamps: [],
  };
}

function recoverRuntimeState(
  program: AdvancedOutletProgram,
  previous: AdvancedOutletRuntimeState | undefined,
  context: AdvancedOutletSafetyContext,
): AdvancedOutletRuntimeState {
  if (
    !previous ||
    previous.version !== advancedOutletRuntimeStateVersion ||
    previous.programId !== program.id ||
    !validTimestamp(previous.lastEvaluatedAt) ||
    !validTimestamp(previous.observedStateSince) ||
    epoch(context.now) < epoch(previous.lastEvaluatedAt)
  ) {
    return initializeRuntimeState(program, context);
  }

  const sameDate = previous.dailyRuntimeDate === context.localDate;
  const elapsed = elapsedSeconds(previous.lastEvaluatedAt, context.now);
  let dailyOnSeconds = sameDate ? previous.dailyOnSeconds : 0;
  if (previous.observedState === "on") {
    // If evaluation spans local midnight, conservatively charge the elapsed
    // interval to the new day. Over-counting is safer than losing runtime.
    dailyOnSeconds += elapsed;
  }

  const observedChanged = previous.observedState !== context.observedState;
  const revisionChanged = previous.programRevision !== program.revision;
  const transitions = previous.transitionTimestamps
    .filter(validTimestamp)
    .filter((timestamp) => epoch(context.now) - epoch(timestamp) < 3_600_000);
  if (observedChanged) transitions.push(context.now);

  return {
    version: advancedOutletRuntimeStateVersion,
    programId: program.id,
    programRevision: program.revision,
    observedState: context.observedState,
    observedStateSince: observedChanged ? context.now : previous.observedStateSince,
    lastEvaluatedAt: context.now,
    dailyRuntimeDate: context.localDate,
    dailyOnSeconds,
    ...(observedChanged || revisionChanged ? {} : previous.pendingTransition ? {
      pendingTransition: previous.pendingTransition,
    } : {}),
    transitionTimestamps: transitions,
  };
}

function withPending(
  state: AdvancedOutletRuntimeState,
  targetState: AdvancedOutletPowerState,
  now: string,
): AdvancedOutletRuntimeState {
  if (state.pendingTransition?.targetState === targetState) return state;
  return { ...state, pendingTransition: { targetState, startedAt: now } };
}

function clearPending(state: AdvancedOutletRuntimeState): AdvancedOutletRuntimeState {
  if (!state.pendingTransition) return state;
  const { pendingTransition: _, ...cleared } = state;
  return cleared;
}

function waitDecision(
  state: AdvancedOutletRuntimeState,
  desiredState: AdvancedOutletPowerState,
  reason: AdvancedOutletSafetyReason,
  waitSeconds: number,
): AdvancedOutletSafetyDecision {
  return {
    requestedState: null,
    effectiveDesiredState: desiredState,
    reason,
    waitSeconds: Math.max(1, Math.ceil(waitSeconds)),
    runtimeState: state,
  };
}

/**
 * Applies stateful protections to one evaluator result. The returned runtime
 * state is safe to persist immediately. A requested state is not considered
 * applied until a later call observes the physical outlet in that state.
 */
export function applyAdvancedOutletSafety(
  program: AdvancedOutletProgram,
  evaluation: AdvancedOutletEvaluationResult,
  previous: AdvancedOutletRuntimeState | undefined,
  context: AdvancedOutletSafetyContext,
): AdvancedOutletSafetyDecision {
  if (!validTimestamp(context.now) || !/^\d{4}-\d{2}-\d{2}$/.test(context.localDate)) {
    throw new Error("Advanced outlet safety requires a valid instant and local date");
  }

  let state = recoverRuntimeState(program, previous, context);
  if (evaluation.status === "disabled" || evaluation.desiredState === null) {
    state = clearPending(state);
    return {
      requestedState: null,
      effectiveDesiredState: null,
      reason: "program-disabled",
      runtimeState: state,
    };
  }

  const continuousOnSeconds = context.observedState === "on"
    ? elapsedSeconds(state.observedStateSince, context.now)
    : 0;
  const continuousLimit = program.safety.maximumContinuousOnSeconds;
  const dailyLimit = program.safety.maximumDailyRuntimeSeconds;
  const continuousExceeded = continuousLimit !== undefined && continuousOnSeconds >= continuousLimit;
  const dailyExceeded = dailyLimit !== undefined && state.dailyOnSeconds >= dailyLimit;
  const missingInputShutdown = evaluation.status === "missing-input" &&
    program.safety.missingInputState === "off";

  const desiredState: AdvancedOutletPowerState =
    continuousExceeded || dailyExceeded || missingInputShutdown
      ? "off"
      : evaluation.desiredState;
  const safetyReason: AdvancedOutletSafetyReason | undefined = continuousExceeded
    ? "maximum-continuous-runtime"
    : dailyExceeded
      ? "maximum-daily-runtime"
      : missingInputShutdown
        ? "missing-input-safety"
        : undefined;

  if (desiredState === context.observedState) {
    state = clearPending(state);
    return {
      requestedState: null,
      effectiveDesiredState: desiredState,
      reason: "already-in-state",
      runtimeState: state,
    };
  }

  // Fail-safe OFF transitions always bypass timing rules.
  if (safetyReason) {
    state = clearPending(state);
    return {
      requestedState: "off",
      effectiveDesiredState: "off",
      reason: safetyReason,
      runtimeState: state,
    };
  }

  const minimumSeconds = context.observedState === "on"
    ? program.safety.minimumOnSeconds
    : program.safety.minimumOffSeconds;
  const stateAge = elapsedSeconds(state.observedStateSince, context.now);
  if (stateAge < minimumSeconds) {
    state = withPending(state, desiredState, context.now);
    return waitDecision(
      state,
      desiredState,
      context.observedState === "on" ? "minimum-on-active" : "minimum-off-active",
      minimumSeconds - stateAge,
    );
  }

  const transitionLimit = program.safety.maximumTransitionsPerHour;
  if (desiredState === "on" && transitionLimit !== undefined &&
    state.transitionTimestamps.length >= transitionLimit) {
    state = withPending(state, desiredState, context.now);
    const oldest = Math.min(...state.transitionTimestamps.map(epoch));
    return waitDecision(state, desiredState, "transition-limit-active", (oldest + 3_600_000 - epoch(context.now)) / 1000);
  }

  const deferSeconds = desiredState === "on"
    ? program.safety.deferOnSeconds
    : program.safety.deferOffSeconds;
  state = withPending(state, desiredState, context.now);
  const pendingAge = elapsedSeconds(state.pendingTransition!.startedAt, context.now);
  if (pendingAge < deferSeconds) {
    return waitDecision(state, desiredState, "defer-active", deferSeconds - pendingAge);
  }

  return {
    requestedState: desiredState,
    effectiveDesiredState: desiredState,
    reason: evaluation.status === "missing-input" ? "missing-input-safety" : "program-request",
    runtimeState: state,
  };
}
