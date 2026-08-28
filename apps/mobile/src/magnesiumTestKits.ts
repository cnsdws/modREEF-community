import type { MeasurementEvent } from "@modreef/digital-twin";

export type MagnesiumKitId =
  | "magnesium-direct"
  | "magnesium-aquaforest"
  | "magnesium-elos"
  | "magnesium-hanna"
  | "magnesium-nyos"
  | "magnesium-red-sea"
  | "magnesium-salifert"
  | "magnesium-seachem-first"
  | "magnesium-seachem-second";

export interface MagnesiumTestKit {
  id: MagnesiumKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Syringe";
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

export const magnesiumTestKits: readonly MagnesiumTestKit[] = [
  {
    id: "magnesium-direct",
    brand: "None",
    inputLabel: "Result",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 3000,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the measured magnesium directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "magnesium-aquaforest",
    brand: "Aquaforest",
    product: "Magnesium Test Kit",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount remaining in the titration syringe.",
    calculatePpm: (reading) => Math.round((1 - reading) * 1500),
  },
  {
    id: "magnesium-elos",
    brand: "Elos",
    product: "AquaTest Mg",
    inputLabel: "Drops A",
    inputUnit: "drops",
    minimum: 1,
    maximum: 50,
    decimals: 0,
    resultDecimals: 0,
    secondaryInput: {
      label: "Drops D",
      unit: "drops",
      minimum: 1,
      maximum: 50,
      decimals: 0,
    },
    guidance: "Enter both reagent A and reagent D drop counts.",
    calculatePpm: (reading, secondaryReading = 0) =>
      Math.max(0, Math.round((reading - secondaryReading) * 50)),
  },
  {
    id: "magnesium-hanna",
    brand: "Hanna",
    product: "HI783 Marine Magnesium Checker",
    inputLabel: "Checker reading",
    inputUnit: "ppm",
    minimum: 1000,
    maximum: 1800,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the ppm value displayed by the checker.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "magnesium-nyos",
    brand: "Nyos",
    product: "Magnesium Test Kit",
    inputLabel: "Titrant used",
    inputUnit: "mL",
    minimum: 0.38,
    maximum: 1,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount of titrant used at the endpoint.",
    calculatePpm: (reading) => Math.round(reading * 1500),
  },
  {
    id: "magnesium-red-sea",
    brand: "Red Sea",
    product: "Magnesium Pro",
    inputLabel: "Titrant used",
    inputUnit: "mL",
    minimum: 0.38,
    maximum: 0.8,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount of titrant used at the endpoint.",
    calculatePpm: (reading) => Math.round(reading * 2000),
  },
  {
    id: "magnesium-salifert",
    brand: "Salifert",
    product: "Magnesium Profi Test",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 0.98,
    decimals: 2,
    resultDecimals: 0,
    guidance: "Enter the amount remaining at the black syringe plunger.",
    calculatePpm: (reading) => Math.round((1 - reading) * 1500),
  },
  {
    id: "magnesium-seachem-first",
    brand: "Seachem",
    optionField: "Syringe",
    optionLabel: "First",
    product: "Reef Status Magnesium",
    resolution: "First syringe",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 1,
    resultDecimals: 0,
    guidance: "Choose First when the endpoint is reached with the first syringe.",
    calculatePpm: (reading) => Math.round((1 - reading) * 1250),
  },
  {
    id: "magnesium-seachem-second",
    brand: "Seachem",
    optionField: "Syringe",
    optionLabel: "Second",
    product: "Reef Status Magnesium",
    resolution: "Second syringe",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 0.9,
    decimals: 1,
    resultDecimals: 0,
    guidance: "Choose Second when titration continues into a second syringe.",
    calculatePpm: (reading) => Math.round(2500 - reading * 1250),
  },
];

export const magnesiumManufacturers = [
  "None",
  "Aquaforest",
  "Elos",
  "Hanna",
  "Nyos",
  "Red Sea",
  "Salifert",
  "Seachem",
] as const;

export function magnesiumKit(id: string): MagnesiumTestKit {
  return (
    magnesiumTestKits.find((kit) => kit.id === id) ??
    magnesiumTestKits[0]!
  );
}

export function magnesiumKitsForBrand(
  brand: string,
): readonly MagnesiumTestKit[] {
  return magnesiumTestKits.filter((kit) => kit.brand === brand);
}

export function magnesiumKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): MagnesiumTestKit | null {
  if (event.parameter !== "magnesium" || !event.testKit) return null;

  if (event.testKit.brand === "Seachem") {
    return magnesiumKit(
      event.testKit.resolution?.startsWith("Second")
        ? "magnesium-seachem-second"
        : "magnesium-seachem-first",
    );
  }

  return (
    magnesiumTestKits.find(
      (kit) => kit.brand === event.testKit?.brand,
    ) ?? null
  );
}

export function magnesiumReadingIsValid(
  kit: MagnesiumTestKit,
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
