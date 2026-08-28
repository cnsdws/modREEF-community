import type { MeasurementEvent } from "@modreef/digital-twin";

export type CalciumKitId =
  | "calcium-direct"
  | "calcium-api"
  | "calcium-aquaforest"
  | "calcium-elos"
  | "calcium-hanna"
  | "calcium-nyos"
  | "calcium-red-sea"
  | "calcium-salifert-high"
  | "calcium-salifert-low"
  | "calcium-seachem";

export interface CalciumTestKit {
  id: CalciumKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Resolution";
  product?: string;
  resolution?: string;
  inputLabel: string;
  inputUnit: string;
  minimum: number;
  maximum: number;
  decimals: number;
  resultDecimals: number;
  secondaryInput?: {
    label: string;
    unit: string;
    minimum: number;
    maximum: number;
    decimals: number;
  };
  guidance: string;
  calculatePpm(reading: number, secondaryReading?: number): number;
}

export const calciumTestKits: readonly CalciumTestKit[] = [
  {
    id: "calcium-direct",
    brand: "None",
    inputLabel: "Result",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 1000,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the measured calcium directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "calcium-api",
    brand: "API",
    product: "Calcium Test Kit",
    inputLabel: "Drops",
    inputUnit: "drops",
    minimum: 1,
    maximum: 26,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the number of drops used to reach the endpoint.",
    calculatePpm: (reading) => reading * 20,
  },
  {
    id: "calcium-aquaforest",
    brand: "Aquaforest",
    product: "Calcium Test Kit",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount remaining in the titration syringe.",
    calculatePpm: (reading) => Math.round((1 - reading) * 500),
  },
  {
    id: "calcium-elos",
    brand: "Elos",
    product: "AquaTest Ca",
    inputLabel: "Drops C",
    inputUnit: "drops",
    minimum: 1,
    maximum: 20,
    decimals: 0,
    resultDecimals: 0,
    secondaryInput: {
      label: "Drops D",
      unit: "drops",
      minimum: 0,
      maximum: 20,
      decimals: 0,
    },
    guidance: "Enter both reagent C and reagent D drop counts.",
    calculatePpm: (reading, secondaryReading = 0) =>
      reading * 50 + secondaryReading * 10,
  },
  {
    id: "calcium-hanna",
    brand: "Hanna",
    product: "HI758 Marine Calcium Checker",
    inputLabel: "Checker reading",
    inputUnit: "ppm",
    minimum: 200,
    maximum: 600,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the ppm value displayed by the checker.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "calcium-nyos",
    brand: "Nyos",
    product: "Calcium Test Kit",
    inputLabel: "Titrant used",
    inputUnit: "mL",
    minimum: 0.38,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount of titrant used at the endpoint.",
    calculatePpm: (reading) => Math.round(reading * 500),
  },
  {
    id: "calcium-red-sea",
    brand: "Red Sea",
    product: "Calcium Pro",
    inputLabel: "Titrant used",
    inputUnit: "mL",
    minimum: 0.58,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount of titrant used at the endpoint.",
    calculatePpm: (reading) => Math.round(reading * 500),
  },
  {
    id: "calcium-salifert-high",
    brand: "Salifert",
    optionField: "Resolution",
    optionLabel: "High (2 mL)",
    product: "Calcium Profi Test",
    resolution: "High (2 mL)",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount remaining at the black syringe plunger.",
    calculatePpm: (reading) => Math.round((1 - reading) * 500),
  },
  {
    id: "calcium-salifert-low",
    brand: "Salifert",
    optionField: "Resolution",
    optionLabel: "Low (1 mL)",
    product: "Calcium Profi Test",
    resolution: "Low (1 mL)",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount remaining at the black syringe plunger.",
    calculatePpm: (reading) => Math.round((1 - reading) * 1000),
  },
  {
    id: "calcium-seachem",
    brand: "Seachem",
    product: "Calcium titration test",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 1,
    resultDecimals: 0,
    guidance: "Enter the amount remaining in the titration syringe.",
    calculatePpm: (reading) => Math.round((1 - reading) * 500),
  },
];

export const calciumManufacturers = [
  "None",
  "API",
  "Aquaforest",
  "Elos",
  "Hanna",
  "Nyos",
  "Red Sea",
  "Salifert",
  "Seachem",
] as const;

export function calciumKit(id: string): CalciumTestKit {
  return (
    calciumTestKits.find((kit) => kit.id === id) ?? calciumTestKits[0]!
  );
}

export function calciumKitsForBrand(
  brand: string,
): readonly CalciumTestKit[] {
  return calciumTestKits.filter((kit) => kit.brand === brand);
}

export function calciumKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): CalciumTestKit | null {
  if (event.parameter !== "calcium" || !event.testKit) return null;

  if (event.testKit.brand === "Salifert") {
    return calciumKit(
      event.testKit.resolution?.startsWith("Low")
        ? "calcium-salifert-low"
        : "calcium-salifert-high",
    );
  }

  return calciumTestKits.find(
    (kit) => kit.brand === event.testKit?.brand,
  ) ?? null;
}

export function calciumReadingIsValid(
  kit: CalciumTestKit,
  reading: number,
  secondaryReading?: number,
): boolean {
  const primaryValid =
    Number.isFinite(reading) &&
    reading >= kit.minimum &&
    reading <= kit.maximum &&
    (kit.decimals > 0 || Number.isInteger(reading));

  if (!primaryValid || !kit.secondaryInput) return primaryValid;

  return (
    secondaryReading !== undefined &&
    Number.isFinite(secondaryReading) &&
    secondaryReading >= kit.secondaryInput.minimum &&
    secondaryReading <= kit.secondaryInput.maximum &&
    (kit.secondaryInput.decimals > 0 ||
      Number.isInteger(secondaryReading))
  );
}
