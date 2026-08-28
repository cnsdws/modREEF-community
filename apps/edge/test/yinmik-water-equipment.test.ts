import { describe, expect, it } from "vitest";
import {
  addYinmikWaterDevice,
  appendRawWaterSamples,
  appendWaterMeasurementHistory,
  applyWaterProbeCalibration,
  filteredWaterMeasurements,
  practicalSalinityFromConductivity,
  yinmikWaterMeasurements,
  waterMeasurementStability,
} from "../src/yinmik-water-equipment.js";
import { createInitialTwin } from "../src/initial-twin.js";

describe("addYinmikWaterDevice", () => {
  it("registers one physical sensor and one locked measurement endpoint", () => {
    const once = addYinmikWaterDevice(createInitialTwin(), "eb62ccaacc41390ee4dj9y");
    const twice = addYinmikWaterDevice(once, "eb62ccaacc41390ee4dj9y");

    expect(twice.devices).toHaveLength(1);
    expect(twice.devices?.[0]).toMatchObject({
      manufacturer: "YINMIK",
      model: "Water 7-in-1",
    });
    expect(twice.equipment).toHaveLength(1);
    expect(twice.equipment[0]).toMatchObject({
      role: "sensor",
      physicalDeviceId: "eb62ccaacc41390ee4dj9y",
      binding: { channelId: "water-quality", capability: "measurement" },
    });
  });
});

describe("YINMIK water measurements", () => {
  it("implements the PSS-78 seawater reference point", () => {
    expect(practicalSalinityFromConductivity(42.914, 15)).toBeCloseTo(35, 2);
  });

  it("maps the WIFI-3188 DPS schema to live water quality readings", () => {
    const readings = yinmikWaterMeasurements("reef", "device", {
      "2": 218, "10": 803, "11": 49448, "12": 188,
    }, "2026-08-09T00:00:00.000Z");
    expect(Object.fromEntries(readings.map((reading) => [reading.parameter, reading.value]))).toEqual({
      temperature: 71.24,
      ph: 8.03,
      orp: 188,
      salinity: expect.any(Number),
    });
    expect(readings.find(({ parameter }) => parameter === "salinity")?.value).toBeGreaterThan(30);
  });

  it("applies probe calibration without changing raw readings", () => {
    const raw = yinmikWaterMeasurements("reef", "device", {
      "2": 200, "10": 810, "11": 42914, "12": 380,
    }, "2026-08-09T00:00:00.000Z");
    const calibrated = applyWaterProbeCalibration(raw, {
      temperature: { offset: 1.5, calibratedAt: "2026-08-09T00:00:00.000Z" },
      ph: { points: [
        { raw: 4.1, reference: 4, capturedAt: "2026-08-09T00:00:00.000Z" },
        { raw: 8.1, reference: 7, capturedAt: "2026-08-09T00:00:00.000Z" },
      ], calibratedAt: "2026-08-09T00:00:00.000Z" },
      orp: { offset: 20, reference: 400, calibratedAt: "2026-08-09T00:00:00.000Z" },
      salinity: { scale: 1.02, reference: 35, calibratedAt: "2026-08-09T00:00:00.000Z" },
    });
    expect(calibrated.find(({ parameter }) => parameter === "temperature")?.value).toBe(69.5);
    expect(calibrated.find(({ parameter }) => parameter === "ph")?.value).toBe(7);
    expect(calibrated.find(({ parameter }) => parameter === "orp")?.value).toBe(400);
    expect(raw.find(({ parameter }) => parameter === "orp")?.value).toBe(380);
  });

  it("keeps five-minute samples within the rolling 24-hour window", () => {
    const now = Date.parse("2026-08-10T12:00:00.000Z");
    const reading = yinmikWaterMeasurements("reef", "device", { "10": 800 }, new Date(now).toISOString());
    const first = appendWaterMeasurementHistory([], reading, now);
    expect(appendWaterMeasurementHistory(first, reading, now + 30_000)).toHaveLength(1);
    expect(appendWaterMeasurementHistory(first, reading, now + 301_000)).toHaveLength(2);
  });

  it("uses a trimmed rolling mean to reject bouncy probe outliers", () => {
    const startedAt = Date.parse("2026-08-10T12:00:00.000Z");
    const values = [8, 8.01, 8.02, 8.01, 8, 8.02, 8.01, 8, 3, 14, 15, 2];
    const samples = values.flatMap((value, index) => yinmikWaterMeasurements(
      "reef",
      "device",
      { "10": Math.round(value * 100) },
      new Date(startedAt + index * 5_000).toISOString(),
    ));
    expect(filteredWaterMeasurements(samples)[0]?.value).toBeCloseTo(8.01, 2);
  });

  it("retains one minute of raw samples and reports calibration stability", () => {
    const now = Date.parse("2026-08-10T12:01:00.000Z");
    let samples: ReturnType<typeof yinmikWaterMeasurements> = [];
    for (let index = 0; index < 12; index += 1) {
      const measuredAt = now - (11 - index) * 5_000;
      samples = appendRawWaterSamples(samples, yinmikWaterMeasurements(
        "reef", "device", { "10": 800 + index % 2 }, new Date(measuredAt).toISOString(),
      ), measuredAt);
    }
    expect(samples).toHaveLength(12);
    expect(waterMeasurementStability(samples).ph).toMatchObject({
      sampleCount: 12,
      range: 0.01,
      stable: true,
    });
    const later = appendRawWaterSamples(samples, yinmikWaterMeasurements(
      "reef", "device", { "10": 800 }, new Date(now + 61_000).toISOString(),
    ), now + 61_000);
    expect(later).toHaveLength(1);
  });
});
