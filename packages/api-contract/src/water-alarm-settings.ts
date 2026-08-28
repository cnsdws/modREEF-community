export const waterAlarmMetrics = ["temperature", "ph", "orp", "salinity"] as const;
export type WaterAlarmMetric = typeof waterAlarmMetrics[number];

export interface WaterAlarmRule {
  enabled: boolean;
  label: string;
  lower: number;
  upper: number;
  unit: string;
}

export interface WaterAlarmRules {
  edgeWatchdogEnabled: boolean;
  equipmentEnabled: boolean;
  metrics: Record<WaterAlarmMetric, WaterAlarmRule>;
}

export interface WaterAlarmSettings {
  aquariumId: string;
  revision: number;
  updatedAt: string;
  rules: WaterAlarmRules;
}

export const defaultWaterAlarmRules: WaterAlarmRules = {
  edgeWatchdogEnabled: true,
  equipmentEnabled: true,
  metrics: {
    temperature: { enabled: true, label: "Temperature", lower: 76, upper: 80, unit: "°F" },
    ph: { enabled: true, label: "pH", lower: 7.8, upper: 8.5, unit: "" },
    orp: { enabled: true, label: "ORP", lower: 200, upper: 450, unit: "mV" },
    salinity: { enabled: true, label: "Salinity", lower: 33, upper: 36, unit: "ppt" },
  },
};

export function isWaterAlarmRules(value: unknown): value is WaterAlarmRules {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.edgeWatchdogEnabled !== "boolean" ||
      typeof candidate.equipmentEnabled !== "boolean" ||
      !candidate.metrics || typeof candidate.metrics !== "object") return false;
  const metrics = candidate.metrics as Record<string, unknown>;
  return waterAlarmMetrics.every((metric) => {
    const rule = metrics[metric];
    if (!rule || typeof rule !== "object") return false;
    const item = rule as Record<string, unknown>;
    return typeof item.enabled === "boolean" && typeof item.label === "string" &&
      typeof item.lower === "number" && Number.isFinite(item.lower) &&
      typeof item.upper === "number" && Number.isFinite(item.upper) && item.lower < item.upper &&
      typeof item.unit === "string";
  });
}
