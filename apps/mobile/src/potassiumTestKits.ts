import type { MeasurementEvent } from "@modreef/digital-twin";

export type PotassiumKitId =
  | "potassium-direct"
  | "potassium-colombo-marine"
  | "potassium-fauna-marin"
  | "potassium-giesemann"
  | "potassium-korallen-zucht"
  | "potassium-red-sea"
  | "potassium-salifert"
  | "potassium-tropic-marin";

export interface PotassiumTestKit {
  id: PotassiumKitId;
  brand: string;
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
  formatResult?(reading: number, result: number): string;
}

const correctedProfessionalResult = (
  reading: number,
  correction = 0,
) => Math.round(300 + reading * 250 + correction);

export const potassiumTestKits: readonly PotassiumTestKit[] = [
  {
    id: "potassium-direct",
    brand: "None",
    inputLabel: "Result",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 1000,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the measured potassium directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "potassium-colombo-marine",
    brand: "Colombo Marine",
    product: "Potassium (K) Test",
    inputLabel: "K-3 titrant used",
    inputUnit: "mL",
    minimum: 0.3,
    maximum: 0.7,
    decimals: 2,
    resultDecimals: 1,
    guidance:
      "Enter the K-3 volume used when the sample changes from yellow to blue.",
    calculatePpm: (reading) => 500 - reading * 250,
  },
  {
    id: "potassium-fauna-marin",
    brand: "Fauna Marin",
    product: "AquaHomeTest K",
    resolution: "5 ppm",
    inputLabel: "Reagent D remaining",
    inputUnit: "mL",
    minimum: 0,
    maximum: 0.8,
    decimals: 2,
    resultDecimals: 0,
    secondaryInput: {
      label: "Correction value",
      unit: "ppm",
      minimum: -200,
      maximum: 200,
      decimals: 0,
    },
    guidance:
      "Enter reagent D remaining and the current correction value from the 400 ppm standard (for example, -20).",
    calculatePpm: correctedProfessionalResult,
  },
  {
    id: "potassium-giesemann",
    brand: "Giesemann",
    product: "Professional Potassium Test",
    inputLabel: "K-3 titrant used",
    inputUnit: "mL",
    minimum: 0.3,
    maximum: 0.7,
    decimals: 2,
    resultDecimals: 1,
    guidance:
      "Enter the K-3 volume used when the sample changes from yellow to blue.",
    calculatePpm: (reading) => 500 - reading * 250,
  },
  {
    id: "potassium-korallen-zucht",
    brand: "Korallen-Zucht",
    product: "Potassium Test Kit",
    inputLabel: "Card reading",
    inputUnit: "ppm",
    minimum: 250,
    maximum: 500,
    decimals: 0,
    resultDecimals: 0,
    guidance:
      "Enter the ppm value aligned with the center of the vial holder on the supplied scale.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "potassium-red-sea",
    brand: "Red Sea",
    product: "Potassium Pro",
    resolution: "3 ppm",
    inputLabel: "Titrant D used",
    inputUnit: "mL",
    minimum: 0.01,
    maximum: 0.5,
    decimals: 2,
    resultDecimals: 0,
    guidance:
      "Enter the amount used from the syringe's 0.50 mL starting position.",
    calculatePpm: (reading) => Math.round(470 - reading * 300),
  },
  {
    id: "potassium-salifert",
    brand: "Salifert",
    product: "Potassium Reef Test",
    resolution: "10 ppm",
    inputLabel: "K-3 drops",
    inputUnit: "drops",
    minimum: 1,
    maximum: 25,
    decimals: 0,
    resultDecimals: 0,
    guidance:
      "Count K-3 drops until the sample changes from white or yellowish to baby blue.",
    calculatePpm: (reading) =>
      reading <= 3 ? 470 : Math.round(500 - reading * 10),
    formatResult: (reading, result) =>
      reading <= 3 ? `≥${result.toFixed(0)} ppm` : `${result.toFixed(0)} ppm`,
  },
  {
    id: "potassium-tropic-marin",
    brand: "Tropic Marin",
    product: "K+ Pro Test",
    resolution: "5 ppm",
    inputLabel: "Reagent D remaining",
    inputUnit: "mL",
    minimum: 0,
    maximum: 0.8,
    decimals: 2,
    resultDecimals: 0,
    secondaryInput: {
      label: "Correction value",
      unit: "ppm",
      minimum: -200,
      maximum: 200,
      decimals: 0,
    },
    guidance:
      "Enter reagent D remaining and the current correction value from the 400 ppm standard (for example, -20).",
    calculatePpm: correctedProfessionalResult,
  },
];

export const potassiumManufacturers = [
  "None",
  "Colombo Marine",
  "Fauna Marin",
  "Giesemann",
  "Korallen-Zucht",
  "Red Sea",
  "Salifert",
  "Tropic Marin",
] as const;

export function potassiumKit(id: string): PotassiumTestKit {
  return (
    potassiumTestKits.find((kit) => kit.id === id) ??
    potassiumTestKits[0]!
  );
}

export function potassiumKitsForBrand(
  brand: string,
): readonly PotassiumTestKit[] {
  return potassiumTestKits.filter((kit) => kit.brand === brand);
}

export function potassiumKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): PotassiumTestKit | null {
  if (event.parameter !== "potassium" || !event.testKit) return null;

  return (
    potassiumTestKits.find(
      (kit) => kit.brand === event.testKit?.brand,
    ) ?? null
  );
}

export function potassiumReadingIsValid(
  kit: PotassiumTestKit,
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

export function potassiumResultLabel(
  kit: PotassiumTestKit,
  reading: number,
  result: number,
): string {
  return kit.formatResult
    ? kit.formatResult(reading, result)
    : `${result.toFixed(kit.resultDecimals)} ppm`;
}
