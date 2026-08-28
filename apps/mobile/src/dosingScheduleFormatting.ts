export function durationText(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remainder > 0 || parts.length === 0) {
    parts.push(`${remainder} second${remainder === 1 ? "" : "s"}`);
  }
  return parts.join(" ");
}

export function formatTimeInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2
    ? digits
    : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
