import type {
  AquariumEvent,
  WaterMeasurement,
  WaterParameter,
} from "@modreef/digital-twin";

const waterParameters = new Set<WaterParameter>([
  "temperature", "salinity", "ph", "orp", "alkalinity", "calcium",
  "magnesium", "potassium", "iodine", "nitrate", "phosphate", "iron", "other",
]);

export function measurementFromEvent(
  value: unknown,
  fallbackAquariumId: string,
): WaterMeasurement | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Partial<AquariumEvent> & Record<string, unknown>;
  if (
    event.type !== "measurement" ||
    typeof event.id !== "string" ||
    typeof event.parameter !== "string" ||
    !waterParameters.has(event.parameter as WaterParameter) ||
    typeof event.value !== "number" ||
    !Number.isFinite(event.value) ||
    typeof event.unit !== "string" ||
    typeof event.occurredAt !== "string" ||
    Number.isNaN(Date.parse(event.occurredAt))
  ) return null;

  const source = event.source === "manual" || event.source === "sensor" ||
      event.source === "imported"
    ? event.source
    : "sensor";
  return {
    id: event.id,
    aquariumId: typeof event.aquariumId === "string"
      ? event.aquariumId
      : fallbackAquariumId,
    parameter: event.parameter as WaterParameter,
    value: event.value,
    unit: event.unit,
    measuredAt: event.occurredAt,
    source,
  };
}
