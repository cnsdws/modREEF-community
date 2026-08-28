import { describe, expect, it } from "vitest";
import type { Equipment } from "@modreef/digital-twin";
import { buildReefCoachReport } from "../src/reef-coach.js";

const observedAt = "2026-08-10T12:00:00.000Z";

function sensor(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "water-1",
    aquariumId: "reef",
    name: "Water Monitor",
    role: "sensor",
    enabled: true,
    connectionStatus: "online",
    healthStatus: "normal",
    liveMeasurements: [{
      id: "ph-live",
      aquariumId: "reef",
      parameter: "ph",
      value: 8.12,
      unit: "",
      measuredAt: observedAt,
      source: "sensor",
    }],
    measurementHistory: [{
      id: "ph-old",
      aquariumId: "reef",
      parameter: "ph",
      value: 8.02,
      unit: "",
      measuredAt: "2026-08-10T00:00:00.000Z",
      source: "sensor",
    }],
    waterProbeCalibration: {
      ph: {
        points: [
          { raw: 4, reference: 4, capturedAt: observedAt },
          { raw: 7, reference: 7, capturedAt: observedAt },
        ],
        calibratedAt: observedAt,
      },
    },
    waterMeasurementStability: {
      ph: { sampleCount: 12, windowStartedAt: observedAt, range: 0.01, stable: true },
    },
    ...overrides,
  };
}

describe("Reef Coach Observer report", () => {
  it("does not treat powered equipment classified as Sensor as the water meter", () => {
    const report = buildReefCoachReport({
      aquarium: { id: "reef", name: "Display Reef" },
      equipment: [{
        ...sensor({ id: "powered-sensor", liveMeasurements: [], measurementHistory: [] }),
        physicalCapability: "power",
      }, sensor({ id: "water-meter", physicalCapability: "measurement" })],
      observedAt,
    });

    expect(report.snapshot.waterQuality.ph?.evidenceId).toContain("water-meter");
    expect(report.snapshot.equipment.total).toBe(1);
  });

  it("builds evidence-linked trends and visible confidence", () => {
    const report = buildReefCoachReport({
      aquarium: { id: "reef", name: "Display Reef" },
      equipment: [sensor()],
      observedAt,
    });
    expect(report.snapshot.waterQuality.ph).toMatchObject({
      current: 8.12,
      minimum24Hours: 8.02,
      maximum24Hours: 8.12,
      change24Hours: 0.1,
      calibrated: true,
      stable: true,
      confidence: "high",
    });
    expect(report.recommendation.observations[0]?.evidenceIds[0]).toContain("measurement:water-1:ph");
    expect(report.recommendation.confidence).toBe("low");
    expect(report.recommendation.missingInformation).toContain("No current temperature reading.");
  });

  it("recommends inspection instead of action for stale data", () => {
    const stale = sensor({
      liveMeasurements: [{
        id: "ph-stale", aquariumId: "reef", parameter: "ph", value: 7.9,
        unit: "", measuredAt: "2026-08-10T11:30:00.000Z", source: "sensor",
      }],
      measurementHistory: [],
    });
    const report = buildReefCoachReport({
      aquarium: { id: "reef", name: "Display Reef" },
      equipment: [stale],
      observedAt,
    });
    expect(report.recommendation).toMatchObject({ severity: "warning", confidence: "low" });
    expect(report.recommendation.recommendations[0]?.requiresConfirmation).toBe(false);
    expect(report.recommendation.recommendations[0]?.action).toContain("Inspect");
  });
});
