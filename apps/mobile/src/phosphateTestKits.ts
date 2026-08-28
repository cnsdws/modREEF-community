import type { MeasurementEvent } from "@modreef/digital-twin";

export type PhosphateKitId =
  | "phosphate-direct"
  | "phosphate-api"
  | "phosphate-elos"
  | "phosphate-hanna-hi774"
  | "phosphate-hanna-hi736"
  | "phosphate-hanna-hi706"
  | "phosphate-hanna-hi717"
  | "phosphate-hanna-hi713"
  | "phosphate-nyos"
  | "phosphate-red-sea-low"
  | "phosphate-red-sea-high"
  | "phosphate-salifert-low"
  | "phosphate-salifert-high"
  | "phosphate-seachem";

export interface PhosphateReadingChoice {
  value: number;
  color: string;
  textColor?: string;
}

export interface PhosphateTestKit {
  id: PhosphateKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Checker" | "Range" | "Sensitivity";
  product?: string;
  resolution?: string;
  inputLabel: string;
  inputUnit: string;
  minimum: number;
  maximum: number;
  decimals: number;
  resultDecimals: number;
  choices?: readonly PhosphateReadingChoice[];
  guidance: string;
  calculatePpm(reading: number): number;
}

const choice = (
  value: number,
  color: string,
  textColor = "#061528",
): PhosphateReadingChoice => ({ value, color, textColor });

const redSeaLowChoices = [
  choice(0, "#F6F7E8"), choice(0.01, "#E1F5EC"),
  choice(0.02, "#C8F0E5"), choice(0.04, "#A6E9DE"),
  choice(0.08, "#78D9CC"), choice(0.12, "#48CBBE"),
  choice(0.16, "#00BFAF"),
] as const;

export const phosphateTestKits: readonly PhosphateTestKit[] = [
  {
    id: "phosphate-direct", brand: "None", inputLabel: "Result", inputUnit: "ppm",
    minimum: 0, maximum: 50, decimals: 3, resultDecimals: 3,
    guidance: "Enter the measured phosphate directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-api", brand: "API", product: "Phosphate Test Kit",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 10,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#E7DA8E"), choice(0.25, "#C9C889"), choice(0.5, "#ADBD83"),
      choice(1, "#A2AE83"), choice(2, "#8CB08F"), choice(5, "#3E8B9A"),
      choice(10, "#2B5984", "#FFFFFF"),
    ],
    guidance: "Select the closest API phosphate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-elos", brand: "Elos", product: "AquaTest PO4",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 1,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#DDD8D5"), choice(0.05, "#CAC8D0"), choice(0.1, "#AFB4C9"),
      choice(0.25, "#87A4C1"), choice(0.5, "#6697B8"),
      choice(0.75, "#3F7DB2"), choice(1, "#2864A2", "#FFFFFF"),
    ],
    guidance: "Select the closest Elos phosphate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-hanna-hi774", brand: "Hanna", optionField: "Checker",
    optionLabel: "Phosphate ULR HI774", product: "HI774 Marine Phosphate ULR",
    resolution: "Phosphate ULR HI774", inputLabel: "Checker reading", inputUnit: "ppm",
    minimum: 0, maximum: 0.9, decimals: 2, resultDecimals: 2,
    guidance: "Enter the ppm phosphate value displayed by the HI774.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-hanna-hi736", brand: "Hanna", optionField: "Checker",
    optionLabel: "Phosphorus ULR HI736", product: "HI736 Marine Phosphorus ULR",
    resolution: "Phosphorus ULR HI736", inputLabel: "Checker reading", inputUnit: "ppb P",
    minimum: 0, maximum: 200, decimals: 0, resultDecimals: 3,
    guidance: "Enter the ppb phosphorus display reading; modREEF converts it to ppm phosphate.",
    calculatePpm: (reading) => (reading * 3.066) / 1000,
  },
  {
    id: "phosphate-hanna-hi706", brand: "Hanna", optionField: "Checker",
    optionLabel: "Phosphorus HR HI706", product: "HI706 Phosphorus HR",
    resolution: "Phosphorus HR HI706", inputLabel: "Checker reading", inputUnit: "ppm P",
    minimum: 0, maximum: 15, decimals: 1, resultDecimals: 2,
    guidance: "Enter the ppm phosphorus display reading; modREEF converts it to ppm phosphate.",
    calculatePpm: (reading) => reading * 3.066,
  },
  {
    id: "phosphate-hanna-hi717", brand: "Hanna", optionField: "Checker",
    optionLabel: "Phosphate HR HI717", product: "HI717 Phosphate HR",
    resolution: "Phosphate HR HI717", inputLabel: "Checker reading", inputUnit: "ppm",
    minimum: 0, maximum: 30, decimals: 1, resultDecimals: 1,
    guidance: "Enter the ppm phosphate value displayed by the HI717.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-hanna-hi713", brand: "Hanna", optionField: "Checker",
    optionLabel: "Phosphate HI713", product: "HI713 Phosphate LR",
    resolution: "Phosphate HI713", inputLabel: "Checker reading", inputUnit: "ppm",
    minimum: 0, maximum: 2.5, decimals: 2, resultDecimals: 2,
    guidance: "Enter the ppm phosphate value displayed by the HI713.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-nyos", brand: "Nyos", product: "Phosphate Reefer Test Kit",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 1,
    decimals: 3, resultDecimals: 3,
    choices: [
      choice(0, "#F4F2ED"), choice(0.025, "#EEEDEB"), choice(0.05, "#E7E7E8"),
      choice(0.075, "#DEE1E8"), choice(0.1, "#D4D9E6"),
      choice(0.15, "#C8CDDE"), choice(0.2, "#B7BED7"),
      choice(0.3, "#A2ACCB"), choice(0.5, "#7E96D1"),
      choice(1, "#303EC2", "#FFFFFF"),
    ],
    guidance: "Select the closest Nyos phosphate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-red-sea-low", brand: "Red Sea", optionField: "Range",
    optionLabel: "Low", product: "Phosphate Pro", resolution: "Low",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 0.16,
    decimals: 2, resultDecimals: 2, choices: redSeaLowChoices,
    guidance: "Select the closest Red Sea low-range comparator value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-red-sea-high", brand: "Red Sea", optionField: "Range",
    optionLabel: "High", product: "Phosphate Pro", resolution: "High",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 2.72,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#F6F7E8"), choice(0.17, "#E1F5EC"),
      choice(0.34, "#C8F0E5"), choice(0.68, "#A6E9DE"),
      choice(1.36, "#78D9CC"), choice(2.04, "#48CBBE"),
      choice(2.72, "#00BFAF"),
    ],
    guidance: "Select the closest Red Sea high-range comparator value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-salifert-low", brand: "Salifert", optionField: "Sensitivity",
    optionLabel: "Low (10 mL)", product: "Phosphate Profi-Test", resolution: "Low (10 mL)",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 3,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#F5F7F6"), choice(0.03, "#DDE7E9"), choice(0.1, "#D0DDE2"),
      choice(0.25, "#C2D6DD"), choice(0.5, "#AFCDD7"),
      choice(1, "#83BDCC"), choice(3, "#15AEDA"),
    ],
    guidance: "Use the 10 mL procedure and select the closest color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-salifert-high", brand: "Salifert", optionField: "Sensitivity",
    optionLabel: "High (20 mL)", product: "Phosphate Profi-Test", resolution: "High (20 mL)",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 1.5,
    decimals: 3, resultDecimals: 3,
    choices: [
      choice(0, "#F5F7F6"), choice(0.015, "#DDE7E9"), choice(0.05, "#D0DDE2"),
      choice(0.125, "#C2D6DD"), choice(0.25, "#AFCDD7"),
      choice(0.5, "#83BDCC"), choice(1.5, "#15AEDA"),
    ],
    guidance: "Use the 20 mL high-sensitivity procedure and select the closest color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "phosphate-seachem", brand: "Seachem", product: "MultiTest Phosphate",
    inputLabel: "Color-card reading", inputUnit: "ppm", minimum: 0, maximum: 3,
    decimals: 2, resultDecimals: 2,
    choices: [
      choice(0, "#B3A135"), choice(0.05, "#AAA03C"), choice(0.1, "#9C9B42"),
      choice(0.2, "#8A914A"), choice(0.5, "#6E8148"), choice(1, "#477445"),
      choice(1.5, "#246447", "#FFFFFF"), choice(2, "#005542", "#FFFFFF"),
      choice(2.5, "#004C3C", "#FFFFFF"), choice(3, "#004438", "#FFFFFF"),
    ],
    guidance: "Select the closest Seachem phosphate color-card value.",
    calculatePpm: (reading) => reading,
  },
];

export const phosphateManufacturers = [
  "None", "API", "Elos", "Hanna", "Nyos", "Red Sea", "Salifert", "Seachem",
] as const;

export function phosphateKit(id: string): PhosphateTestKit {
  return phosphateTestKits.find((kit) => kit.id === id) ?? phosphateTestKits[0]!;
}

export function phosphateKitsForBrand(brand: string): readonly PhosphateTestKit[] {
  return phosphateTestKits.filter((kit) => kit.brand === brand);
}

export function phosphateKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): PhosphateTestKit | null {
  if (event.parameter !== "phosphate" || !event.testKit) return null;
  const resolution = event.testKit.resolution ?? "";
  return phosphateTestKits.find((kit) =>
    kit.brand === event.testKit?.brand && (!kit.resolution || kit.resolution === resolution)
  ) ?? phosphateTestKits.find((kit) => kit.brand === event.testKit?.brand) ?? null;
}

export function phosphateReadingIsValid(kit: PhosphateTestKit, reading: number): boolean {
  if (!Number.isFinite(reading) || reading < kit.minimum || reading > kit.maximum) return false;
  return kit.choices
    ? kit.choices.some((item) => Math.abs(item.value - reading) < 0.000001)
    : kit.decimals > 0 || Number.isInteger(reading);
}

export function phosphateResultLabel(kit: PhosphateTestKit, result: number): string {
  return `${result.toFixed(kit.resultDecimals)} ppm`;
}
