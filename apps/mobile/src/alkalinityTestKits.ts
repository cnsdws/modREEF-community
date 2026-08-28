import type { MeasurementEvent } from "@modreef/digital-twin";

export type AlkalinityKitId =
  | "direct"
  | "api"
  | "aquaforest"
  | "elos"
  | "hanna-hi772"
  | "hanna-hi755"
  | "hanna-hi775"
  | "nyos"
  | "red-sea"
  | "salifert-high"
  | "salifert-low"
  | "seachem";

export interface AlkalinityTestKit {
  id: AlkalinityKitId;
  brand: string;
  optionLabel?: string;
  optionField?: "Checker" | "Resolution";
  product?: string;
  resolution?: string;
  inputLabel: string;
  inputUnit: string;
  minimum: number;
  maximum: number;
  decimals: number;
  resultDecimals: number;
  guidance: string;
  calculateDkh(reading: number): number;
}

function rounded(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.max(0, Math.round(value * factor) / factor);
}

export const alkalinityTestKits: readonly AlkalinityTestKit[] = [
  {
    id: "direct",
    brand: "None",
    inputLabel: "Result",
    inputUnit: "dKH",
    minimum: 0,
    maximum: 20,
    decimals: 2,
    resultDecimals: 2,
    guidance: "Enter the measured alkalinity directly in dKH.",
    calculateDkh: (reading) => reading,
  },
  {
    id: "api",
    brand: "API",
    product: "KH Carbonate Hardness Test Kit",
    inputLabel: "Drops",
    inputUnit: "drops",
    minimum: 0,
    maximum: 12,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the number of drops used to reach the endpoint.",
    calculateDkh: (reading) => reading,
  },
  {
    id: "aquaforest",
    brand: "Aquaforest",
    product: "Alkalinity Test Kit",
    inputLabel: "Syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 2,
    resultDecimals: 2,
    guidance: "Enter the final titration-syringe reading.",
    calculateDkh: (reading) => rounded((1 - reading) * 14, 2),
  },
  {
    id: "elos",
    brand: "Elos",
    product: "AquaTest KH",
    inputLabel: "Drops",
    inputUnit: "drops",
    minimum: 1,
    maximum: 20,
    decimals: 0,
    resultDecimals: 1,
    guidance: "Enter the number of drops used to reach the endpoint.",
    calculateDkh: (reading) => rounded(reading * 0.5, 1),
  },
  {
    id: "hanna-hi772",
    brand: "Hanna",
    optionField: "Checker",
    optionLabel: "Alkalinity (dKH) HI772",
    product: "HI772 Marine Alkalinity Checker",
    inputLabel: "Checker reading",
    inputUnit: "dKH",
    minimum: 0,
    maximum: 20,
    decimals: 1,
    resultDecimals: 1,
    guidance: "Enter the dKH value displayed by the checker.",
    calculateDkh: (reading) => rounded(reading, 1),
  },
  {
    id: "hanna-hi755",
    brand: "Hanna",
    optionField: "Checker",
    optionLabel: "Alkalinity (ppm) HI755",
    product: "HI755 Marine Alkalinity Checker",
    inputLabel: "Checker reading",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 300,
    decimals: 0,
    resultDecimals: 2,
    guidance: "Enter the ppm CaCO₃ value displayed by the checker.",
    calculateDkh: (reading) => rounded(reading / 17.86, 2),
  },
  {
    id: "hanna-hi775",
    brand: "Hanna",
    optionField: "Checker",
    optionLabel: "Freshwater Alkalinity HI775",
    product: "HI775 Freshwater Alkalinity Checker",
    inputLabel: "Checker reading",
    inputUnit: "ppm",
    minimum: 0,
    maximum: 500,
    decimals: 0,
    resultDecimals: 2,
    guidance: "Enter the ppm CaCO₃ value displayed by the checker.",
    calculateDkh: (reading) => rounded(reading / 17.86, 2),
  },
  {
    id: "nyos",
    brand: "Nyos",
    product: "KH Test (drop-count version)",
    inputLabel: "Drops",
    inputUnit: "drops",
    minimum: 1,
    maximum: 15,
    decimals: 0,
    resultDecimals: 0,
    guidance: "Enter the number of drops used to reach the endpoint.",
    calculateDkh: (reading) => reading,
  },
  {
    id: "red-sea",
    brand: "Red Sea",
    product: "KH/Alkalinity Pro",
    inputLabel: "Titrant used",
    inputUnit: "mL",
    minimum: 0.38,
    maximum: 1,
    decimals: 2,
    resultDecimals: 2,
    guidance: "Enter the amount of titrant used at the color-change endpoint.",
    calculateDkh: (reading) => rounded(reading * 14, 2),
  },
  {
    id: "salifert-high",
    brand: "Salifert",
    optionField: "Resolution",
    optionLabel: "High (4 mL)",
    product: "KH/Alkalinity",
    resolution: "High (4 mL)",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 0.98,
    decimals: 2,
    resultDecimals: 1,
    guidance: "Enter the amount remaining at the black syringe plunger.",
    calculateDkh: (reading) => rounded((0.98 - reading) * 16, 1),
  },
  {
    id: "salifert-low",
    brand: "Salifert",
    optionField: "Resolution",
    optionLabel: "Low (2 mL)",
    product: "KH/Alkalinity",
    resolution: "Low (2 mL)",
    inputLabel: "Final syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 0.98,
    decimals: 2,
    resultDecimals: 1,
    guidance: "Enter the amount remaining at the black syringe plunger.",
    calculateDkh: (reading) => rounded((0.98 - reading) * 32, 1),
  },
  {
    id: "seachem",
    brand: "Seachem",
    product: "Alkalinity titration test",
    inputLabel: "Syringe reading",
    inputUnit: "mL",
    minimum: 0,
    maximum: 1,
    decimals: 1,
    resultDecimals: 1,
    guidance: "Enter the final titration-syringe reading.",
    calculateDkh: (reading) => rounded((1 - reading) * 10, 1),
  },
];

export const alkalinityManufacturers = [
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

export function alkalinityKit(id: string): AlkalinityTestKit {
  const currentId =
    id === "salifert-alkalinity" ? "salifert-high" : id;
  return (
    alkalinityTestKits.find((kit) => kit.id === currentId) ??
    alkalinityTestKits[0]!
  );
}

export function alkalinityKitsForBrand(
  brand: string,
): readonly AlkalinityTestKit[] {
  return alkalinityTestKits.filter((kit) => kit.brand === brand);
}

export function alkalinityKitForEvent(
  event: Pick<MeasurementEvent, "parameter" | "testKit">,
): AlkalinityTestKit | null {
  if (event.parameter !== "alkalinity" || !event.testKit) {
    return null;
  }

  const { brand, product, resolution } = event.testKit;

  if (brand === "Hanna") {
    if (product?.includes("HI755")) return alkalinityKit("hanna-hi755");
    if (product?.includes("HI775")) return alkalinityKit("hanna-hi775");
    return alkalinityKit("hanna-hi772");
  }

  if (brand === "Salifert") {
    return alkalinityKit(
      resolution?.startsWith("Low") ? "salifert-low" : "salifert-high",
    );
  }

  return alkalinityTestKits.find((kit) => kit.brand === brand) ?? null;
}

export function readingIsValid(
  kit: AlkalinityTestKit,
  reading: number,
): boolean {
  return (
    Number.isFinite(reading) &&
    reading >= kit.minimum &&
    reading <= kit.maximum &&
    (kit.decimals > 0 || Number.isInteger(reading))
  );
}
