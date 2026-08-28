import { describe, expect, it } from "vitest";

import { createActivityEvent } from "../src/activity-log.js";

describe("activity log events", () => {
  it("creates a server-owned automation event", () => {
    const event = createActivityEvent(
      "reef",
      {
        source: "automation",
        category: "equipment",
        action: "turned-off",
        title: "Return Pump turned off",
        details: "Paused for feed cycle",
        equipmentId: "return-pump",
        alertId: "equipment:return-pump:connection",
      },
      new Date("2026-07-22T20:00:00Z"),
    );

    expect(event).toMatchObject({
      aquariumId: "reef",
      source: "automation",
      type: "activity",
      category: "equipment",
      action: "turned-off",
      title: "Return Pump turned off",
      equipmentId: "return-pump",
      alertId: "equipment:return-pump:connection",
      occurredAt: "2026-07-22T20:00:00.000Z",
      recordedAt: "2026-07-22T20:00:00.000Z",
    });
    expect(event.id).toEqual(expect.any(String));
  });
});
