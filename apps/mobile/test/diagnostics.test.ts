import { describe, expect, it } from "vitest";

import type { AquariumEvent, Equipment } from "@modreef/digital-twin";

import {
  acknowledgedAlertsFromEvents,
  alertReadingsFromMeasurements,
  defaultAlertRules,
  getDiagnosticIssues,
  requirePersistentWaterIssues,
} from "../src/diagnostics";

function equipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    aquariumId: "reef",
    connectionStatus: "online",
    enabled: true,
    healthStatus: "normal",
    id: "return",
    name: "Return Pump",
    role: "return-pump",
    ...overrides,
  };
}

describe("getDiagnosticIssues", () => {
  it("derives shared acknowledgement state from the latest alert event", () => {
    const event = (
      action: "activated" | "acknowledged" | "resolved",
      occurredAt: string,
    ): AquariumEvent => ({
      action,
      alertId: "equipment:return:connection",
      aquariumId: "reef",
      category: "alert",
      id: `${action}-${occurredAt}`,
      occurredAt,
      recordedAt: occurredAt,
      source: action === "acknowledged" ? "manual" : "automation",
      title: action,
      type: "activity",
    });

    expect(acknowledgedAlertsFromEvents([
      event("acknowledged", "2026-08-05T15:01:00Z"),
      event("activated", "2026-08-05T15:00:00Z"),
    ])).toEqual({
      "equipment:return:connection": "2026-08-05T15:01:00Z",
    });
    expect(acknowledgedAlertsFromEvents([
      event("resolved", "2026-08-05T15:02:00Z"),
      event("acknowledged", "2026-08-05T15:01:00Z"),
    ])).toEqual({});

    expect(acknowledgedAlertsFromEvents([
      event("activated", "2026-08-05T15:02:00Z"),
      event("acknowledged", "2026-08-05T15:01:00Z"),
    ])).toEqual({
      "equipment:return:connection": "2026-08-05T15:01:00Z",
    });
  });

  it("reconciles acknowledgements written before alert IDs were supported", () => {
    const identified: AquariumEvent = {
      action: "activated",
      alertId: "equipment:return:connection",
      aquariumId: "reef",
      category: "alert",
      id: "identified",
      occurredAt: "2026-08-05T15:02:00Z",
      recordedAt: "2026-08-05T15:02:00Z",
      source: "automation",
      title: "Alert activated: Return Pump is offline",
      type: "activity",
    };
    const legacyAcknowledgement: AquariumEvent = {
      action: "acknowledged",
      aquariumId: "reef",
      category: "alert",
      id: "legacy",
      occurredAt: "2026-08-05T15:01:00Z",
      recordedAt: "2026-08-05T15:01:00Z",
      source: "manual",
      title: "Acknowledged alert: Return Pump is offline",
      type: "activity",
    };

    expect(acknowledgedAlertsFromEvents([
      identified,
      legacyAcknowledgement,
    ])).toEqual({
      "equipment:return:connection": "2026-08-05T15:01:00Z",
    });
  });

  it("reports a disconnected life-support device as critical", () => {
    expect(
      getDiagnosticIssues(
        [equipment({ connectionStatus: "offline" })],
        "online",
      ),
    ).toMatchObject([
      {
        id: "equipment:return:connection",
        severity: "critical",
      },
    ]);
  });

  it("does not duplicate an offline device health issue", () => {
    expect(
      getDiagnosticIssues(
        [
          equipment({
            connectionStatus: "offline",
            healthStatus: "critical",
          }),
        ],
        "online",
      ),
    ).toHaveLength(1);
  });

  it("reports edge loss and sorts critical issues first", () => {
    const issues = getDiagnosticIssues(
      [
        equipment({
          id: "light",
          name: "Light",
          role: "light",
          healthStatus: "warning",
        }),
      ],
      "offline",
    );

    expect(issues.map((issue) => issue.id)).toEqual([
      "edge:offline",
      "equipment:light:health",
    ]);
  });

  it("applies configured water-quality thresholds", () => {
    const issues = getDiagnosticIssues(
      [],
      "online",
      defaultAlertRules,
      {
        temperature: {
          measuredAt: "2026-07-23T12:00:00Z",
          value: 81.2,
        },
        ph: {
          measuredAt: "2026-07-23T12:00:00Z",
          value: 8.2,
        },
      },
    );

    expect(issues).toMatchObject([
      {
        id: "water:temperature:high",
        severity: "critical",
      },
    ]);
  });

  it("allows equipment and watchdog alarms to be disabled", () => {
    const issues = getDiagnosticIssues(
      [equipment({ connectionStatus: "offline" })],
      "offline",
      {
        ...defaultAlertRules,
        edgeWatchdogEnabled: false,
        equipmentEnabled: false,
      },
    );

    expect(issues).toEqual([]);
  });

  it("suppresses disabled alarms for every supported water-quality metric", () => {
    const readings = {
      temperature: { measuredAt: "2026-08-10T12:00:00Z", value: 100 },
      ph: { measuredAt: "2026-08-10T12:00:00Z", value: 10 },
      orp: { measuredAt: "2026-08-10T12:00:00Z", value: 900 },
      salinity: { measuredAt: "2026-08-10T12:00:00Z", value: 50 },
    };
    const disabled = {
      ...defaultAlertRules,
      metrics: Object.fromEntries(Object.entries(defaultAlertRules.metrics).map(
        ([metric, rule]) => [metric, { ...rule, enabled: false }],
      )) as typeof defaultAlertRules.metrics,
    };
    expect(getDiagnosticIssues([], "online", disabled, readings)).toEqual([]);
  });

  it("uses the newest supported water measurement", () => {
    expect(
      alertReadingsFromMeasurements([
        {
          aquariumId: "reef",
          id: "old",
          measuredAt: "2026-07-22T12:00:00Z",
          parameter: "temperature",
          source: "sensor",
          unit: "°F",
          value: 77,
        },
        {
          aquariumId: "reef",
          id: "new",
          measuredAt: "2026-07-23T12:00:00Z",
          parameter: "temperature",
          source: "sensor",
          unit: "°F",
          value: 78,
        },
      ]),
    ).toMatchObject({
      temperature: { value: 78 },
    });
  });

  it("requires water-quality issues to remain active for two minutes", () => {
    const issue = getDiagnosticIssues([], "online", defaultAlertRules, {
      ph: { measuredAt: "2026-08-10T12:00:00Z", value: 7.5 },
    });
    const first = requirePersistentWaterIssues(issue, {}, 1_000);
    expect(first.issues).toEqual([]);
    expect(requirePersistentWaterIssues(issue, first.pendingSince, 120_999).issues).toEqual([]);
    expect(requirePersistentWaterIssues(issue, first.pendingSince, 121_000).issues).toHaveLength(1);
    expect(requirePersistentWaterIssues([], first.pendingSince, 122_000).pendingSince).toEqual({});
  });
});
