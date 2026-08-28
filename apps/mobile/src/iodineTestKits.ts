import type { MeasurementEvent } from "@modreef/digital-twin";

export type IodineKitId =
  | "iodine-direct"
  | "iodine-hanna-hi718"
  | "iodine-red-sea"
  | "iodine-salifert-iodide"
  | "iodine-salifert-iodate"
  | "iodine-seachem";

export interface IodineReadingChoice {
  value: number;
  color: string;
  textColor?: string;
}

export interface IodineTestKit {
  id: IodineKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Mode";
  product?: string;
  resolution?: string;
  inputLabel: string;
  inputUnit: string;
  minimum: number;
  maximum: number;
  decimals: number;
  resultDecimals: number;
  choices?: readonly IodineReadingChoice[];
  guidance: string;
  calculatePpm(reading: number): number;
}

const choice = (
  value: number,
  color: string,
  textColor?: string,
): IodineReadingChoice => ({
  value,
  color,
  ...(textColor ? { textColor } : {}),
});

const salifertChoices = [
  choice(0.01, "#D9D1B5", "#061528"),
  choice(0.03, "#CFC38B", "#061528"),
  choice(0.06, "#D1C253", "#061528"),
  choice(0.1, "#C7AF00", "#061528"),
] as const;

export const iodineTestKits: readonly IodineTestKit[] = [
  {
    id: "iodine-direct",
    brand: "None",
    inputLabel: "Result",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 12.5,
    decimals: 2,
    resultDecimals: 2,
    guidance: "Enter the measured iodine directly in ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iodine-hanna-hi718",
    brand: "Hanna",
    product: "HI718 Marine Iodine Checker",
    inputLabel: "Checker reading",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 12.5,
    decimals: 1,
    resultDecimals: 1,
    guidance: "Enter the ppm value displayed by the HI718 checker.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iodine-red-sea",
    brand: "Red Sea",
    product: "Iodine Pro",
    inputLabel: "Color-card reading",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 0.09,
    decimals: 2,
    resultDecimals: 2,
    choices: [
      choice(0, "#D95720"),
      choice(0.03, "#C67816"),
      choice(0.06, "#C99E10", "#061528"),
      choice(0.09, "#D8C891", "#061528"),
    ],
    guidance: "Select the closest color-card value when the standard reaches 0.06 ppm.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iodine-salifert-iodide",
    brand: "Salifert",
    optionField: "Mode",
    optionLabel: "Iodide",
    product: "Iodine Profi-Test",
    resolution: "Iodide",
    inputLabel: "Color-card reading",
    inputUnit: "ppm",
    minimum: 0.01,
    maximum: 0.1,
    decimals: 2,
    resultDecimals: 2,
    choices: salifertChoices,
    guidance: "Run the iodide procedure and select the closest iodide color-card value after exactly four minutes.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iodine-salifert-iodate",
    brand: "Salifert",
    optionField: "Mode",
    optionLabel: "Iodate + iodine",
    product: "Iodine Profi-Test",
    resolution: "Iodate + iodine",
    inputLabel: "Color-card reading",
    inputUnit: "ppm",
    minimum: 0.01,
    maximum: 0.1,
    decimals: 2,
    resultDecimals: 2,
    choices: salifertChoices,
    guidance: "Run the iodate/iodine procedure and select the closest iodate color-card value.",
    calculatePpm: (reading) => reading,
  },
  {
    id: "iodine-seachem",
    brand: "Seachem",
    product: "MultiTest Iodine & Iodide",
    inputLabel: "Color-card reading",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 0.1,
    decimals: 2,
    resultDecimals: 2,
    choices: [
      choice(0, "#E8E9EA", "#061528"),
      choice(0.01, "#C7CED3", "#061528"),
      choice(0.02, "#A9B9C1", "#061528"),
      choice(0.03, "#8EABB4", "#061528"),
      choice(0.04, "#7296A2", "#061528"),
      choice(0.05, "#6192A4", "#061528"),
      choice(0.06, "#4E889D"),
      choice(0.08, "#37798F"),
      choice(0.1, "#2B6B82"),
    ],
    guidance: "Select the closest color-card value as soon as the sample color peaks.",
    calculatePpm: (reading) => reading,
  },
];

export const iodineManufacturers = [
  "None",
  "Hanna",
  "Red Sea",
  "Salifert",
  "Seachem",
] as const;

export function iodineKit(id: string): IodineTestKit {
  return iodineTestKits.find((kit) => kit.id === id) ?? iodineTestKits[0]!;
}

export function iodineKitsForBrand(brand: string): readonly IodineTestKit[] {
  return iodineTestKits.filter((kit) => kit.brand === brand);
}

export function iodineKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): IodineTestKit | null {
  if (event.parameter !== "iodine" || !event.testKit) return null;

  if (event.testKit.brand === "Salifert") {
    return iodineKit(
      event.testKit.resolution?.startsWith("Iodate")
        ? "iodine-salifert-iodate"
        : "iodine-salifert-iodide",
    );
  }

  return iodineTestKits.find((kit) => kit.brand === event.testKit?.brand) ?? null;
}

export function iodineReadingIsValid(
  kit: IodineTestKit,
  reading: number,
): boolean {
  if (!Number.isFinite(reading) || reading < kit.minimum || reading > kit.maximum) {
    return false;
  }

  return kit.choices
    ? kit.choices.some((item) => Math.abs(item.value - reading) < 0.000001)
    : kit.decimals > 0 || Number.isInteger(reading);
}

export function iodineResultLabel(kit: IodineTestKit, result: number): string {
  return `${result.toFixed(kit.resultDecimals)} ppm`;
}
