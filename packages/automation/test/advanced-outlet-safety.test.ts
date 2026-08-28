import { describe, expect, it } from "vitest";

import type { AdvancedOutletProgram } from "@modreef/digital-twin";
import {
  applyAdvancedOutletSafety,
  type AdvancedOutletEvaluationResult,
  type AdvancedOutletRuntimeState,
} from "../src/index.js";

const program: AdvancedOutletProgram = {
  schema: "modreef.advanced-outlet-program",
  version: 1,
  id: "advanced-1",
  revision: 1,
  name: "Advanced outlet",
  enabled: true,
  defaultState: "off",
  fallbackState: "off",
  rules: [],
  safety: {
    missingInputState: "off",
    deferOnSeconds: 10,
    deferOffSeconds: 5,
    minimumOnSeconds: 30,
    minimumOffSeconds: 20,
    maximumContinuousOnSeconds: 300,
    maximumDailyRuntimeSeconds: 600,
    maximumTransitionsPerHour: 4,
  },
  updatedAt: "2026-08-03T12:00:00.000Z",
};

function evaluation(
  desiredState: "on" | "off" | null,
  status: AdvancedOutletEvaluationResult["status"] = "evaluated",
): AdvancedOutletEvaluationResult {
  return {
    status,
    desiredState,
    defaultState: "off",
    missingInputs: status === "missing-input" ? ["measurement:temp"] : [],
    trace: [],
  };
}

function context(now: string, observedState: "on" | "off" = "off") {
  return { now, localDate: "2026-08-03", observedState };
}

function persisted(overrides: Partial<AdvancedOutletRuntimeState> = {}): AdvancedOutletRuntimeState {
  return {
    version: 1,
    programId: program.id,
    programRevision: program.revision,
    observedState: "off",
    observedStateSince: "2026-08-03T11:00:00.000Z",
    lastEvaluatedAt: "2026-08-03T11:59:50.000Z",
    dailyRuntimeDate: "2026-08-03",
    dailyOnSeconds: 0,
    transitionTimestamps: [],
    ...overrides,
  };
}

describe("advanced outlet transition safety", () => {
  it("does not request power for a disabled program", () => {
    const result = applyAdvancedOutletSafety(program, evaluation(null, "disabled"), undefined, context("2026-08-03T12:00:00.000Z"));
    expect(result).toMatchObject({ requestedState: null, reason: "program-disabled" });
  });

  it("starts and completes an ON defer without treating a request as applied", () => {
    const first = applyAdvancedOutletSafety(program, evaluation("on"), persisted(), context("2026-08-03T12:00:00.000Z"));
    expect(first).toMatchObject({ requestedState: null, reason: "defer-active", waitSeconds: 10 });
    const second = applyAdvancedOutletSafety(program, evaluation("on"), first.runtimeState, context("2026-08-03T12:00:10.000Z"));
    expect(second).toMatchObject({ requestedState: "on", reason: "program-request" });
    expect(second.runtimeState.observedState).toBe("off");
  });

  it("cancels a pending transition when the desired state returns to observed state", () => {
    const first = applyAdvancedOutletSafety(program, evaluation("on"), persisted(), context("2026-08-03T12:00:00.000Z"));
    const cancelled = applyAdvancedOutletSafety(program, evaluation("off"), first.runtimeState, context("2026-08-03T12:00:04.000Z"));
    expect(cancelled.reason).toBe("already-in-state");
    expect(cancelled.runtimeState.pendingTransition).toBeUndefined();
  });

  it("observes a confirmed physical transition and starts minimum ON time", () => {
    const state = persisted({ pendingTransition: { targetState: "on", startedAt: "2026-08-03T11:59:40.000Z" } });
    const result = applyAdvancedOutletSafety(program, evaluation("off"), state, context("2026-08-03T12:00:00.000Z", "on"));
    expect(result).toMatchObject({ requestedState: null, reason: "minimum-on-active", waitSeconds: 30 });
    expect(result.runtimeState).toMatchObject({ observedState: "on", observedStateSince: "2026-08-03T12:00:00.000Z" });
    expect(result.runtimeState.transitionTimestamps).toEqual(["2026-08-03T12:00:00.000Z"]);
  });

  it("accounts persisted ON runtime across a controller restart", () => {
    const state = persisted({
      observedState: "on",
      observedStateSince: "2026-08-03T11:55:00.000Z",
      lastEvaluatedAt: "2026-08-03T11:59:00.000Z",
      dailyOnSeconds: 300,
    });
    const result = applyAdvancedOutletSafety(program, evaluation("on"), state, context("2026-08-03T12:00:00.000Z", "on"));
    expect(result.runtimeState.dailyOnSeconds).toBe(360);
    expect(result).toMatchObject({ requestedState: "off", reason: "maximum-continuous-runtime" });
  });

  it("resets daily accounting on a new local date conservatively", () => {
    const state = persisted({
      observedState: "on",
      observedStateSince: "2026-08-02T23:58:00.000Z",
      lastEvaluatedAt: "2026-08-02T23:59:50.000Z",
      dailyRuntimeDate: "2026-08-02",
      dailyOnSeconds: 500,
    });
    const result = applyAdvancedOutletSafety(program, evaluation("on"), state, {
      now: "2026-08-03T00:00:10.000Z", localDate: "2026-08-03", observedState: "on",
    });
    expect(result.runtimeState.dailyRuntimeDate).toBe("2026-08-03");
    expect(result.runtimeState.dailyOnSeconds).toBe(20);
  });

  it("forces an immediate OFF transition when an input is missing", () => {
    const state = persisted({
      observedState: "on",
      observedStateSince: "2026-08-03T11:59:55.000Z",
      lastEvaluatedAt: "2026-08-03T11:59:59.000Z",
    });
    const result = applyAdvancedOutletSafety(program, evaluation("off", "missing-input"), state, context("2026-08-03T12:00:00.000Z", "on"));
    expect(result).toMatchObject({ requestedState: "off", reason: "missing-input-safety" });
  });

  it("forces OFF at the daily runtime limit", () => {
    const state = persisted({
      observedState: "on",
      observedStateSince: "2026-08-03T11:59:00.000Z",
      lastEvaluatedAt: "2026-08-03T11:59:59.000Z",
      dailyOnSeconds: 599,
    });
    const result = applyAdvancedOutletSafety(program, evaluation("on"), state, context("2026-08-03T12:00:00.000Z", "on"));
    expect(result).toMatchObject({ requestedState: "off", reason: "maximum-daily-runtime" });
  });

  it("limits only ON transitions so safety shutdown remains possible", () => {
    const timestamps = [0, 10, 20, 30].map((seconds) => `2026-08-03T11:30:${String(seconds).padStart(2, "0")}.000Z`);
    const onResult = applyAdvancedOutletSafety(program, evaluation("on"), persisted({ transitionTimestamps: timestamps }), context("2026-08-03T12:00:00.000Z"));
    expect(onResult).toMatchObject({ requestedState: null, reason: "transition-limit-active" });

    const onState = persisted({
      observedState: "on",
      observedStateSince: "2026-08-03T11:00:00.000Z",
      transitionTimestamps: timestamps,
    });
    const offResult = applyAdvancedOutletSafety(
      { ...program, safety: { ...program.safety, deferOffSeconds: 0 } },
      evaluation("off"), onState, context("2026-08-03T12:00:00.000Z", "on"),
    );
    expect(offResult.requestedState).toBe("off");
  });

  it("discards incompatible persisted state after a program replacement", () => {
    const oldState = persisted({ programId: "old-program", dailyOnSeconds: 500 });
    const result = applyAdvancedOutletSafety(program, evaluation("off"), oldState, context("2026-08-03T12:00:00.000Z"));
    expect(result.runtimeState).toMatchObject({ programId: program.id, dailyOnSeconds: 0 });
  });

  it("retains safety accounting but cancels pending work after a revision change", () => {
    const oldState = persisted({
      programRevision: 1,
      dailyOnSeconds: 200,
      pendingTransition: { targetState: "on", startedAt: "2026-08-03T11:59:55.000Z" },
    });
    const revised = { ...program, revision: 2 };
    const result = applyAdvancedOutletSafety(revised, evaluation("on"), oldState, context("2026-08-03T12:00:00.000Z"));
    expect(result.runtimeState).toMatchObject({ programRevision: 2, dailyOnSeconds: 200 });
    expect(result.runtimeState.pendingTransition?.startedAt).toBe("2026-08-03T12:00:00.000Z");
    expect(result).toMatchObject({ reason: "defer-active", waitSeconds: 10 });
  });
});
