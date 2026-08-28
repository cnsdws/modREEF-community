import type { AlertRule } from "./diagnostics";

export function toggledWaterAlarmRule(rule: AlertRule): AlertRule {
  return { ...rule, enabled: !rule.enabled };
}

export function waterAlarmRuleWithRange(
  rule: AlertRule,
  lowerText: string,
  upperText: string,
): AlertRule | null {
  if (lowerText.trim() === "" || upperText.trim() === "") return null;
  const lower = Number(lowerText);
  const upper = Number(upperText);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) return null;
  return { ...rule, lower, upper };
}
