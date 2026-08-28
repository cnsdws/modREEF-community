export function sanitizeCalibrationNumber(
  value: string,
  allowNegative = false,
): string {
  const normalized = value.replace(",", ".");
  const negative = allowNegative && normalized.trimStart().startsWith("-");
  const unsigned = normalized.replace(/[^\d.]/g, "");
  const [whole = "", ...fractionParts] = unsigned.split(".");
  const hasDecimal = unsigned.includes(".");
  const limitedWhole = whole.slice(0, 2);
  const fraction = fractionParts.join("").slice(0, 2);
  const number = `${limitedWhole}${hasDecimal ? `.${fraction}` : ""}`;
  return `${negative ? "-" : ""}${number}`;
}

export function formatCalibrationNumber(
  value: string,
  allowNegative = false,
): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0.00";
  const minimum = allowNegative ? -99.99 : 0;
  return Math.max(minimum, Math.min(99.99, parsed)).toFixed(2);
}
