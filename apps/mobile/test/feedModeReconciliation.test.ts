import { describe, expect, it } from "vitest";

import type { EdgeFeedMode } from "../src/edgeClient.js";
import {
  feedCycleTargetControllerIds,
  reconcileFeedMode,
} from "../src/feedModeReconciliation.js";

const active: EdgeFeedMode = {
  id: "feed-1",
  intent: "feed-mode",
  startedAt: "2026-07-31T12:00:00.000Z",
  endsAt: "2026-07-31T12:05:00.000Z",
  durationSeconds: 300,
  actions: [],
  phase: "feeding",
};

describe("Feed Cycle cloud reconciliation", () => {
  it("targets only controllers that own Feed Cycle equipment", () => {
    expect(feedCycleTargetControllerIds([
      {
        id: "return", aquariumId: "reef", name: "Return", role: "return-pump",
        enabled: true, connectionStatus: "online", healthStatus: "normal",
      },
      {
        id: "light", aquariumId: "reef", name: "Light", role: "light",
        enabled: true, connectionStatus: "online", healthStatus: "normal",
        binding: { driverId: "driver", deviceId: "strip", channelId: "2", capability: "power" },
      },
    ], { return: "controller-a", light: "controller-b" })).toEqual([
      "controller-a",
    ]);
  });

  it("targets cloud equipment even though private bindings are omitted", () => {
    expect(feedCycleTargetControllerIds([{
      id: "cloud-return", aquariumId: "reef", name: "Return Pump",
      role: "outlet", programType: "return-pump", enabled: true,
      connectionStatus: "online", healthStatus: "normal",
      physicalConnectionId: "outlet-6", physicalDeviceId: "strip-1",
    }], { "cloud-return": "controller-a" })).toEqual(["controller-a"]);
  });

  it("clears an expired local panel when controllers report no active cycle", () => {
    expect(reconcileFeedMode(
      active,
      undefined,
      Date.parse("2026-07-31T12:05:01.000Z"),
    )).toBeNull();
  });

  it("keeps an optimistic cycle before its transition time", () => {
    expect(reconcileFeedMode(
      active,
      undefined,
      Date.parse("2026-07-31T12:04:59.000Z"),
    )).toEqual(active);
  });

  it("preserves the controller-confirmed Feed Cycle identity", () => {
    expect(reconcileFeedMode(active, {
      id: "feed-b",
      status: "feeding",
      startedAt: active.startedAt,
      endsAt: active.endsAt,
      durationSeconds: 600,
      cycleId: "B",
    })).toMatchObject({ id: "feed-b", cycleId: "B" });
  });

  it("clears legacy recovery state because delays are equipment-owned", () => {
    expect(reconcileFeedMode(active, {
      id: "feed-1",
      status: "recovery",
      startedAt: active.startedAt,
      endsAt: active.endsAt,
      durationSeconds: active.durationSeconds,
      recoveryEndsAt: "2026-07-31T12:07:00.000Z",
    })).toBeNull();
  });
});
