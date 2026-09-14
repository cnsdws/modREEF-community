import { describe, expect, it } from "vitest";

import { evaluateAutomationHealth } from "../src/health-status";

describe("automation health timing", () => {
  it("uses monotonic elapsed time for a current heartbeat", () => {
    expect(evaluateAutomationHealth({
      startedAt: 1_000,
      lastCompletedAt: 9_500,
      running: false,
    }, 10_000)).toEqual({
      name: "automation",
      status: "healthy",
      message: "Automation scheduler heartbeat is current",
    });
  });

  it("does not depend on the wall clock when evaluating startup", () => {
    expect(evaluateAutomationHealth({
      startedAt: 5_000,
      running: true,
    }, 8_000)).toEqual({
      name: "automation",
      status: "healthy",
      message: "Automation scheduler is starting",
    });
  });

  it("reports a genuinely stale monotonic heartbeat", () => {
    expect(evaluateAutomationHealth({
      startedAt: 1_000,
      lastCompletedAt: 2_000,
      running: false,
    }, 15_000)).toEqual({
      name: "automation",
      status: "unhealthy",
      message: "Automation heartbeat is 13 seconds old",
    });
  });
});
