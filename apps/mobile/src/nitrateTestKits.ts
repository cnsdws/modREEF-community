import type { MeasurementEvent } from "@modreef/digital-twin";

export type NitrateKitId =
  | "nitrate-direct"
  | "nitrate-api"
  | "nitrate-elos"
  | "nitrate-hanna-hi781"
  | "nitrate-hanna-hi781-diluted"
  | "nitrate-hanna-hi782"
  | "nitrate-nyos"
  | "nitrate-red-sea-low"
  | "nitrate-red-sea-high"
  | "nitrate-salifert-low"
  | "nitrate-salifert-medium"
  | "nitrate-seachem";

export interface NitrateReadingChoice {
  value: number;
  color: string;
  textColor?: string;
}

export interface NitrateTestKit {
  id: NitrateKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Checker" | "Range";
  product?: string;
  resolution?: string;
  inputLabel: string;
  inputUnit: string;
  minimum: number;
  maximum: number;
  decimals: number;
  resultDecimals: number;
  choices?: readonly NitrateReadingChoice[];
  guidance: string;
  calculatePpm(reading: number): number;
}

const choice = (
  value: number,
  color: string,
  textColor = "#061528",
): NitrateReadingChoice => ({ value, color, textColor });

const redSeaLowChoices = [
  choice(0, "#F7F7F4"), choice(0.25, "#E4C9D5"),
  choice(0.5, "#D9AEC6"), choice(0.75, "#D89ABA"),
  choice(1, "#D387B1"), choice(2, "#CF64A3"), choice(4, "#C93191"),
] as const;

const salifertMediumChoices = [
  choice(0, "#FAFAF8"), choice(2, "#D8C2D0"), choice(5, "#CFAAC2"),
  choice(10, "#D391B5"), choice(25, "#CD8AB2"),
  choice(50, "#CE4C9B"), choice(100, "#CA1687"),
] as const;

export const nitrateTestKits: readonly NitrateTestKit[] = [
  {
    id: "nitrate-direct", brand: "None", inputLabel: "Result", inputUnit: "ppm",
    minimum: 0, maximum: 160, decimals: 2, resultDecimals: 2,
    guidance: "Enter the measured nitrate directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-api", brand: "API", product: "Nitrate Test Kit",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 160,
    decimals: 0, resultDecimals: 0,
    choices: [
      choice(0, "#F4DD00"), choice(5, "#E8C000"), choice(10, "#DEA400"),
      choice(20, "#D98C0A"), choice(40, "#DE6A1D"),
      choice(80, "#D9462E"), choice(160, "#CA2E36"),
    ],
    guidance: "Select the closest API nitrate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-elos", brand: "Elos", product: "AquaTest NO3",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 25,
    decimals: 1, resultDecimals: 1,
    choices: [
      choice(0, "#F7F7F4"), choice(1, "#D6AFC1"), choice(2.5, "#CF88AC"),
      choice(5, "#CB6098"), choice(10, "#C73B82"), choice(25, "#C31868"),
    ],
    guidance: "Select the closest Elos nitrate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-hanna-hi781", brand: "Hanna", optionField: "Checker",
    optionLabel: "LR (Undiluted) HI781", product: "HI781 Marine Nitrate LR",
    resolution: "LR (Undiluted) HI781", inputLabel: "Checker reading", inputUnit: "ppm",
    minimum: 0, maximum: 5, decimals: 2, resultDecimals: 2,
    guidance: "Enter the undiluted ppm reading displayed by the HI781.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-hanna-hi781-diluted", brand: "Hanna", optionField: "Checker",
    optionLabel: "LR (Diluted 10x) HI781", product: "HI781 Marine Nitrate LR",
    resolution: "LR (Diluted 10x) HI781", inputLabel: "Checker reading", inputUnit: "ppm",
    minimum: 0, maximum: 5, decimals: 2, resultDecimals: 1,
    guidance: "Enter the diluted HI781 display reading; modREEF applies the approved 10x factor.",
    calculatePpm: (reading) => reading * 10,
  },
  {
    id: "nitrate-hanna-hi782", brand: "Hanna", optionField: "Checker",
    optionLabel: "HR HI782", product: "HI782 Marine Nitrate HR", resolution: "HR HI782",
    inputLabel: "Checker reading", inputUnit: "ppm", minimum: 0, maximum: 75,
    decimals: 1, resultDecimals: 1,
    guidance: "Enter the ppm value displayed by the HI782 checker.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-nyos", brand: "Nyos", product: "Nitrate Reefer Test Kit",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 160,
    decimals: 0, resultDecimals: 0,
    choices: [
      choice(0, "#F8F7F0"), choice(1, "#FFF9D8"), choice(3, "#FFF3B8"),
      choice(5, "#FFE98A"), choice(12, "#FFDF49"), choice(25, "#FFD21B"),
      choice(40, "#FFC51C"), choice(65, "#FFB51C"),
      choice(95, "#FFA51C"), choice(160, "#F46B22"),
    ],
    guidance: "Select the closest Nyos nitrate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-red-sea-low", brand: "Red Sea", optionField: "Range",
    optionLabel: "Low", product: "Nitrate Pro", resolution: "Low (0–4 ppm)",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 4,
    decimals: 2, resultDecimals: 2, choices: redSeaLowChoices,
    guidance: "Select the closest low-range comparator value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-red-sea-high", brand: "Red Sea", optionField: "Range",
    optionLabel: "High (diluted 16x)", product: "Nitrate Pro",
    resolution: "High (diluted 16x)", inputLabel: "Comparator reading",
    inputUnit: "ppm", minimum: 0, maximum: 4, decimals: 2, resultDecimals: 0,
    choices: redSeaLowChoices,
    guidance: "Select the comparator value from the 1 mL sample diluted with 15 mL RO water; modREEF applies the 16x factor.",
    calculatePpm: (reading) => reading * 16,
  },
  {
    id: "nitrate-salifert-low", brand: "Salifert", optionField: "Range",
    optionLabel: "Low 0.2–10 mg/L (ppm)", product: "Nitrate Profi-Test",
    resolution: "Low 0.2–10 mg/L (ppm)", inputLabel: "Color-card reading", inputUnit: "ppm",
    minimum: 0, maximum: 10, decimals: 1, resultDecimals: 1,
    choices: salifertMediumChoices.map((item) => ({ ...item, value: item.value / 10 })),
    guidance: "For the low-range side view, select the printed card value divided by 10.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-salifert-medium", brand: "Salifert", optionField: "Range",
    optionLabel: "Medium 2–100 mg/L (ppm)", product: "Nitrate Profi-Test",
    resolution: "Medium 2–100 mg/L (ppm)", inputLabel: "Color-card reading", inputUnit: "ppm",
    minimum: 0, maximum: 100, decimals: 0, resultDecimals: 0,
    choices: salifertMediumChoices,
    guidance: "For the medium-range top view, select the closest printed color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "nitrate-seachem", brand: "Seachem", product: "MultiTest Nitrite & Nitrate",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 50,
    decimals: 1, resultDecimals: 1,
    choices: [
      choice(0, "#F8F8F6"), choice(2, "#D9B4C6"), choice(5, "#CF8AAF"),
      choice(7.5, "#C75D97"), choice(10, "#BB367E"), choice(20, "#C92764"),
      choice(30, "#C71555"), choice(40, "#B90D47"), choice(50, "#A4083C"),
    ],
    guidance: "Select the closest Seachem nitrate color-card value.",
    calculatePpm: (reading) => reading,
  },
];

export const nitrateManufacturers = [
  "None", "API", "Elos", "Hanna", "Nyos", "Red Sea", "Salifert", "Seachem",
] as const;

export function nitrateKit(id: string): NitrateTestKit {
  return nitrateTestKits.find((kit) => kit.id === id) ?? nitrateTestKits[0]!;
}

export function nitrateKitsForBrand(brand: string): readonly NitrateTestKit[] {
  return nitrateTestKits.filter((kit) => kit.brand === brand);
}

export function nitrateKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): NitrateTestKit | null {
  if (event.parameter !== "nitrate" || !event.testKit) return null;
  const resolution = event.testKit.resolution ?? "";
  return nitrateTestKits.find((kit) =>
    kit.brand === event.testKit?.brand &&
    (!kit.resolution || kit.resolution === resolution)
  ) ?? nitrateTestKits.find((kit) => kit.brand === event.testKit?.brand) ?? null;
}

export function nitrateReadingIsValid(kit: NitrateTestKit, reading: number): boolean {
  if (!Number.isFinite(reading) || reading < kit.minimum || reading > kit.maximum) return false;
  return kit.choices
    ? kit.choices.some((item) => Math.abs(item.value - reading) < 0.000001)
    : kit.decimals > 0 || Number.isInteger(reading);
}

export function nitrateResultLabel(kit: NitrateTestKit, result: number): string {
  return `${result.toFixed(kit.resultDecimals)} ppm`;
}
