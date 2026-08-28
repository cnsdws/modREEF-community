import type { MeasurementEvent } from "@modreef/digital-twin";

export type IronKitId =
  | "iron-direct"
  | "iron-hanna-hi746"
  | "iron-red-sea"
  | "iron-jbl"
  | "iron-sera"
  | "iron-seachem-regular"
  | "iron-seachem-low";

export interface IronReadingChoice {
  value: number;
  color: string;
  textColor?: string;
}

export interface IronTestKit {
  id: IronKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Range";
  product?: string;
  resolution?: string;
  inputLabel: string;
  inputUnit: string;
  minimum: number;
  maximum: number;
  decimals: number;
  resultDecimals: number;
  choices?: readonly IronReadingChoice[];
  guidance: string;
  calculatePpm(reading: number): number;
}

const choice = (
  value: number,
  color: string,
  textColor = "#061528",
): IronReadingChoice => ({ value, color, textColor });

export const ironTestKits: readonly IronTestKit[] = [
  {
    id: "iron-direct", brand: "None", inputLabel: "Result", inputUnit: "ppm",
    minimum: 0, maximum: 2, decimals: 3, resultDecimals: 3,
    guidance: "Enter the measured iron directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iron-hanna-hi746", brand: "Hanna", product: "HI746 Iron Low Range Checker",
    inputLabel: "Checker reading", inputUnit: "ppb", minimum: 0, maximum: 999,
    decimals: 0, resultDecimals: 3,
    guidance: "Enter the ppb value displayed by the HI746; modREEF converts it to ppm.",
    calculatePpm: (reading) => reading / 1000,
  },
  {
    id: "iron-red-sea", brand: "Red Sea", product: "Iron Pro",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 0.5,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#F5E9C8"), choice(0.05, "#E9CF9A"),
      choice(0.1, "#DBA96D"), choice(0.25, "#C9784D", "#FFFFFF"),
      choice(0.5, "#9E473B", "#FFFFFF"),
    ],
    guidance: "Select the closest Iron Pro color-card value after the 15-minute development time.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iron-jbl", brand: "JBL", product: "ProAquaTest Fe",
    inputLabel: "Marine color-card reading", inputUnit: "ppm", minimum: 0, maximum: 1.5,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0.02, "#EADBE0"),
      choice(0.05, "#DABECF"), choice(0.1, "#C99FBC"),
      choice(0.2, "#B57BA8"), choice(0.4, "#985A91", "#FFFFFF"),
      choice(0.6, "#7F477C", "#FFFFFF"), choice(0.8, "#683768", "#FFFFFF"),
      choice(1, "#542A57", "#FFFFFF"), choice(1.5, "#3D1D43", "#FFFFFF"),
    ],
    guidance: "Use the marine row on the JBL comparator card and select its closest value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iron-sera", brand: "Sera", product: "Iron Test",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 0.5,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#F4EEE5"), choice(0.1, "#EBC2BA"),
      choice(0.25, "#DA8C84"), choice(0.5, "#B65358", "#FFFFFF"),
    ],
    guidance: "Select the closest Sera evaluation-chart value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iron-seachem-regular", brand: "Seachem", optionField: "Range",
    optionLabel: "Regular", product: "MultiTest Iron", resolution: "Regular range",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 2,
    decimals: 2, resultDecimals: 2,
    guidance: "Enter the regular-range color-card reading directly.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iron-seachem-low", brand: "Seachem", optionField: "Range",
    optionLabel: "Low range", product: "MultiTest Iron", resolution: "Low range",
    inputLabel: "Color-card reading", inputUnit: "ppm on card", minimum: 0, maximum: 2,
    decimals: 2, resultDecimals: 3,
    guidance: "Enter the low-range card reading; modREEF divides it by four.",
    calculatePpm: (reading) => reading / 4,
  },
];

export const ironManufacturers = ["None", "Hanna", "Red Sea", "JBL", "Sera", "Seachem"] as const;

export function ironKit(id: string): IronTestKit {
  return ironTestKits.find((kit) => kit.id === id) ?? ironTestKits[0]!;
}

export function ironKitsForBrand(brand: string): readonly IronTestKit[] {
  return ironTestKits.filter((kit) => kit.brand === brand);
}

export function ironKitForEvent(event: Pick<MeasurementEvent, "parameter" | "testKit">): IronTestKit | null {
  if (event.parameter !== "iron" || !event.testKit) return null;
  return ironTestKits.find((kit) =>
    kit.brand === event.testKit?.brand &&
    (!kit.resolution || kit.resolution === event.testKit?.resolution)
  ) ?? ironTestKits.find((kit) => kit.brand === event.testKit?.brand) ?? null;
}

export function ironReadingIsValid(kit: IronTestKit, reading: number): boolean {
  if (!Number.isFinite(reading) || reading < kit.minimum || reading > kit.maximum) return false;
  return !kit.choices || kit.choices.some((choiceItem) => choiceItem.value === reading);
}

export function ironResultLabel(kit: IronTestKit, result: number): string {
  return `${result.toFixed(kit.resultDecimals)} ppm Fe`;
}
