import type {
  AquariumDigitalTwin,
  Equipment,
  PhysicalDevice,
  WaterMeasurement,
  WaterMeasurementStability,
  WaterParameter,
  WaterProbeCalibration,
} from "@modreef/digital-twin";

export const yinmikWaterDriverPrefix = "modreef.yinmik-water";
export { yinmikWaterProductId } from "./identity.js";

export function isWaterProbeCalibration(value: unknown): value is WaterProbeCalibration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const calibration = value as Record<string, unknown>;
  const finite = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate);
  const dated = (candidate: unknown) => typeof candidate === "string" && Number.isFinite(Date.parse(candidate));
  if (calibration.temperature !== undefined) {
    const item = calibration.temperature as Record<string, unknown>;
    if (typeof item !== "object" || item === null || !finite(item.offset) || !dated(item.calibratedAt)) return false;
  }
  if (calibration.ph !== undefined) {
    const item = calibration.ph as Record<string, unknown>;
    if (typeof item !== "object" || item === null || !dated(item.calibratedAt) ||
      !Array.isArray(item.points) || item.points.length > 3 || !item.points.every((point) => {
        if (typeof point !== "object" || point === null) return false;
        const candidate = point as Record<string, unknown>;
        return finite(candidate.raw) && finite(candidate.reference) && dated(candidate.capturedAt);
      })) return false;
  }
  if (calibration.orp !== undefined) {
    const item = calibration.orp as Record<string, unknown>;
    if (typeof item !== "object" || item === null || !finite(item.offset) ||
      (item.reference !== 256 && item.reference !== 400) || !dated(item.calibratedAt)) return false;
  }
  if (calibration.salinity !== undefined) {
    const item = calibration.salinity as Record<string, unknown>;
    if (typeof item !== "object" || item === null || !finite(item.scale) ||
      !finite(item.reference) || Number(item.reference) <= 0 || !dated(item.calibratedAt)) return false;
  }
  return true;
}

function numericDps(dps: Record<string, unknown>, key: string): number | undefined {
  const value = dps[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function practicalSalinityFromConductivity(
  conductivityMsCm: number,
  temperatureCelsius: number,
): number | undefined {
  if (conductivityMsCm < 0 || !Number.isFinite(temperatureCelsius)) return undefined;
  const t = temperatureCelsius;
  const rt = 0.6766097 + 0.0200564 * t + 0.0001104259 * t ** 2
    - 0.00000069698 * t ** 3 + 0.0000000010031 * t ** 4;
  const ratio = conductivityMsCm / 42.914 / rt;
  if (ratio < 0 || !Number.isFinite(ratio)) return undefined;
  const x = Math.sqrt(ratio);
  const base = 0.008 - 0.1692 * x + 25.3851 * x ** 2 + 14.0941 * x ** 3
    - 7.0261 * x ** 4 + 2.7081 * x ** 5;
  const correction = (t - 15) / (1 + 0.0162 * (t - 15)) * (
    0.0005 - 0.0056 * x - 0.0066 * x ** 2 - 0.0375 * x ** 3
      + 0.0636 * x ** 4 - 0.0144 * x ** 5
  );
  const salinity = base + correction;
  return Number.isFinite(salinity) ? Math.max(0, Math.min(50, salinity)) : undefined;
}

export function yinmikWaterMeasurements(
  aquariumId: string,
  deviceId: string,
  dps: Record<string, unknown>,
  measuredAt = new Date().toISOString(),
): WaterMeasurement[] {
  const temperatureRaw = numericDps(dps, "2");
  const phRaw = numericDps(dps, "10");
  const conductivityRaw = numericDps(dps, "11");
  const orpRaw = numericDps(dps, "12");
  const temperatureCelsius = temperatureRaw === undefined ? undefined : temperatureRaw / 10;
  const readings: Array<[WaterMeasurement["parameter"], number | undefined, string]> = [
    ["temperature", temperatureCelsius === undefined ? undefined : temperatureCelsius * 9 / 5 + 32, "°F"],
    ["ph", phRaw === undefined ? undefined : phRaw / 100, ""],
    ["orp", orpRaw, "mV"],
    ["salinity", temperatureCelsius === undefined || conductivityRaw === undefined
      ? undefined
      : practicalSalinityFromConductivity(conductivityRaw / 1000, temperatureCelsius), "ppt"],
  ];
  return readings.flatMap(([parameter, value, unit]) => value === undefined ? [] : [{
    id: `yinmik-${encodeURIComponent(deviceId)}-${parameter}`,
    aquariumId,
    parameter,
    value: Math.round(value * 100) / 100,
    unit,
    measuredAt,
    source: "sensor" as const,
  }]);
}

function linearCalibration(
  value: number,
  points: Array<{ raw: number; reference: number }>,
): number {
  if (points.length === 0) return value;
  if (points.length < 2) return value;
  const rawMean = points.reduce((sum, point) => sum + point.raw, 0) / points.length;
  const referenceMean = points.reduce((sum, point) => sum + point.reference, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.raw - rawMean) ** 2, 0);
  if (denominator === 0) return value + referenceMean - rawMean;
  const slope = points.reduce(
    (sum, point) => sum + (point.raw - rawMean) * (point.reference - referenceMean),
    0,
  ) / denominator;
  return referenceMean + slope * (value - rawMean);
}

export function applyWaterProbeCalibration(
  readings: WaterMeasurement[],
  calibration: WaterProbeCalibration | undefined,
): WaterMeasurement[] {
  return readings.map((reading) => {
    let value = reading.value;
    if (reading.parameter === "temperature" && calibration?.temperature) {
      value += calibration.temperature.offset;
    } else if (reading.parameter === "ph" && calibration?.ph) {
      value = linearCalibration(value, calibration.ph.points);
    } else if (reading.parameter === "orp" && calibration?.orp) {
      value += calibration.orp.offset;
    } else if (reading.parameter === "salinity" && calibration?.salinity) {
      value *= calibration.salinity.scale;
    }
    return { ...reading, value: Math.round(value * 100) / 100 };
  });
}

export function appendWaterMeasurementHistory(
  history: WaterMeasurement[] | undefined,
  readings: WaterMeasurement[],
  now = Date.now(),
): WaterMeasurement[] {
  const cutoff = now - 24 * 60 * 60 * 1_000;
  const retained = (history ?? []).filter(
    (measurement) => Date.parse(measurement.measuredAt) >= cutoff,
  );
  const latest = retained.reduce(
    (timestamp, measurement) => Math.max(timestamp, Date.parse(measurement.measuredAt)),
    0,
  );
  if (now - latest < 5 * 60_000) return retained;
  return [...retained, ...readings.map((reading) => ({
    ...reading,
    id: `${reading.id}-${now}`,
  }))];
}

const stabilityRanges: Partial<Record<WaterParameter, number>> = {
  temperature: 0.2,
  ph: 0.03,
  orp: 5,
  salinity: 0.15,
};

export function appendRawWaterSamples(
  samples: WaterMeasurement[] | undefined,
  readings: WaterMeasurement[],
  now = Date.now(),
): WaterMeasurement[] {
  const cutoff = now - 60_000;
  return [
    ...(samples ?? []).filter((sample) => Date.parse(sample.measuredAt) >= cutoff),
    ...readings.map((reading) => ({ ...reading, id: `${reading.id}-raw-${now}` })),
  ];
}

export function filteredWaterMeasurements(
  samples: WaterMeasurement[],
  measuredAt = new Date().toISOString(),
): WaterMeasurement[] {
  const byParameter = new Map<WaterParameter, WaterMeasurement[]>();
  for (const sample of samples) {
    byParameter.set(sample.parameter, [...(byParameter.get(sample.parameter) ?? []), sample]);
  }
  return [...byParameter].map(([parameter, parameterSamples]) => {
    const sorted = parameterSamples.map(({ value }) => value).sort((a, b) => a - b);
    const trim = sorted.length >= 8 ? 2 : sorted.length >= 5 ? 1 : 0;
    const retained = sorted.slice(trim, sorted.length - trim || undefined);
    const value = retained.reduce((sum, item) => sum + item, 0) / retained.length;
    const latest = parameterSamples.reduce((left, right) =>
      Date.parse(left.measuredAt) >= Date.parse(right.measuredAt) ? left : right
    );
    return {
      ...latest,
      id: `${latest.id}-filtered`,
      measuredAt,
      value: Math.round(value * 100) / 100,
    };
  });
}

export function waterMeasurementStability(
  samples: WaterMeasurement[],
): Partial<Record<WaterParameter, WaterMeasurementStability>> {
  const result: Partial<Record<WaterParameter, WaterMeasurementStability>> = {};
  for (const parameter of Object.keys(stabilityRanges) as WaterParameter[]) {
    const matching = samples.filter((sample) => sample.parameter === parameter);
    if (matching.length === 0) continue;
    const values = matching.map(({ value }) => value);
    const range = Math.max(...values) - Math.min(...values);
    const windowStartedAt = matching.reduce((earliest, sample) =>
      Date.parse(sample.measuredAt) < Date.parse(earliest) ? sample.measuredAt : earliest,
    matching[0]!.measuredAt);
    result[parameter] = {
      sampleCount: matching.length,
      windowStartedAt,
      range: Math.round(range * 100) / 100,
      stable: matching.length >= 6 && range <= stabilityRanges[parameter]!,
    };
  }
  return result;
}

export function addYinmikWaterDevice(
  twin: AquariumDigitalTwin,
  deviceId: string,
  displayName = "Water Meter",
): AquariumDigitalTwin {
  const driverId = `${yinmikWaterDriverPrefix}:${deviceId}`;
  const physical: PhysicalDevice = {
    id: deviceId,
    aquariumId: twin.aquarium.id,
    name: displayName,
    manufacturer: "YINMIK",
    model: "Water 7-in-1",
    driverId,
    connectionStatus: "unknown",
    createdAt: new Date().toISOString(),
  };
  const sensorId = `yinmik-water-${encodeURIComponent(deviceId)}`;
  const sensor: Equipment = {
    id: sensorId,
    aquariumId: twin.aquarium.id,
    name: displayName,
    role: "sensor",
    enabled: true,
    connectionStatus: "unknown",
    healthStatus: "normal",
    physicalDeviceId: deviceId,
    physicalDeviceName: displayName,
    binding: {
      driverId,
      deviceId,
      channelId: "water-quality",
      capability: "measurement",
    },
  };
  const existingDevices = twin.devices ?? [];

  return {
    ...twin,
    devices: existingDevices.some(({ id }) => id === deviceId)
      ? existingDevices
      : [...existingDevices, physical],
    equipment: twin.equipment.some(({ id }) => id === sensorId)
      ? twin.equipment
      : [...twin.equipment, sensor],
  };
}
