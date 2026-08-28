import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type {
  Equipment,
  WaterMeasurement,
  WaterMeasurementStability,
  WaterParameter,
  WaterProbeCalibration,
} from "@modreef/digital-twin";
import type { AlertMetric, AlertRule } from "./diagnostics";
import {
  formatCalibrationNumber,
  sanitizeCalibrationNumber,
} from "./waterQualityCalibrationNumber";
import { toggledWaterAlarmRule, waterAlarmRuleWithRange } from "./waterAlarmRule";

const colors: Record<AlertMetric, string> = {
  temperature: "#20B7EC",
  ph: "#34D399",
  orp: "#A78BFA",
  salinity: "#38BDF8",
};

export function WaterQualityDetailPanel({
  metric,
  sensor,
  measurements,
  rule,
  onCalibrationChange,
  onRuleChange,
}: {
  metric: AlertMetric;
  sensor: Equipment;
  measurements: WaterMeasurement[];
  rule: AlertRule;
  onCalibrationChange: (calibration: WaterProbeCalibration) => Promise<void>;
  onRuleChange: (rule: AlertRule) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationSaved, setCalibrationSaved] = useState(false);
  const [temperatureOffset, setTemperatureOffset] = useState("0.00");
  const [salinityReference, setSalinityReference] = useState("35.00");
  const [graphWidth, setGraphWidth] = useState(300);
  const [alarmLower, setAlarmLower] = useState(String(rule.lower));
  const [alarmUpper, setAlarmUpper] = useState(String(rule.upper));
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const [alarmSaving, setAlarmSaving] = useState(false);
  const [alarmSaved, setAlarmSaved] = useState(false);
  const current = sensor.liveMeasurements?.find((item) => item.parameter === metric);
  const calibration = sensor.waterProbeCalibration ?? {};
  // Older Edge snapshots only expose liveMeasurements. Before a metric has
  // been calibrated, that value is the raw probe reading and is safe to use
  // for the first calibration point. Never fall back after calibration, or a
  // subsequent point could compound the existing correction.
  const raw = sensor.rawLiveMeasurements?.find((item) => item.parameter === metric)
    ?? (calibration[metric] === undefined ? current : undefined);
  const instantaneous = sensor.instantaneousRawMeasurements?.find(
    (item) => item.parameter === metric,
  ) ?? raw;
  const stability = sensor.waterMeasurementStability?.[metric];
  const stableForCapture = stability?.stable === true;
  const series = useMemo(() => measurements
    .filter((item) => item.parameter === metric && Date.parse(item.measuredAt) >= Date.now() - 86_400_000)
    .sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt)),
  [measurements, metric]);

  useEffect(() => {
    setAlarmLower(String(rule.lower));
    setAlarmUpper(String(rule.upper));
  }, [metric, rule.lower, rule.upper]);

  useEffect(() => {
    if (!alarmSaved) return;
    const timeout = setTimeout(() => setAlarmSaved(false), 2_000);
    return () => clearTimeout(timeout);
  }, [alarmSaved]);

  useEffect(() => {
    if (!calibrationSaved) return;
    const timeout = setTimeout(() => setCalibrationSaved(false), 2_000);
    return () => clearTimeout(timeout);
  }, [calibrationSaved]);

  async function persistAlarmRule(updated: AlertRule) {
    setAlarmSaving(true);
    setAlarmSaved(false);
    setAlarmError(null);
    try {
      await onRuleChange(updated);
      setAlarmSaved(true);
    } catch (caught) {
      setAlarmError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAlarmSaving(false);
    }
  }

  function saveAlarmRange() {
    const updated = waterAlarmRuleWithRange(rule, alarmLower, alarmUpper);
    if (!updated) {
      setAlarmError("Enter valid limits with LOW below HIGH.");
      return;
    }
    void persistAlarmRule(updated);
  }

  function cancelAlarmRange() {
    setAlarmLower(String(rule.lower));
    setAlarmUpper(String(rule.upper));
    setAlarmError(null);
    setAlarmSaved(false);
  }

  async function save(next: WaterProbeCalibration) {
    setBusy(true);
    setError(null);
    setCalibrationSaved(false);
    try {
      await onCalibrationChange(next);
      setCalibrationSaved(true);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  }

  function capturePh(reference: 4 | 7 | 10) {
    if (!raw) {
      setError("Wait for a live raw pH reading before capturing a calibration point.");
      return;
    }
    if (!stableForCapture) {
      const range = stability?.range;
      setError(
        typeof range === "number"
          ? `The pH reading is still moving (last-minute range ${range.toFixed(2)}). Keep the probe in the solution until the range is 0.03 or less.`
          : "Keep the probe in the solution while modREEF collects one minute of stable readings.",
      );
      return;
    }
    const points = [
      ...(calibration.ph?.points ?? []).filter((point) => point.reference !== reference),
      { raw: raw.value, reference, capturedAt: new Date().toISOString() },
    ].sort((a, b) => a.reference - b.reference);
    void save(withMetric({ points, calibratedAt: new Date().toISOString() }));
  }

  function withMetric(value: WaterProbeCalibration[typeof metric] | undefined): WaterProbeCalibration {
    const next = { ...calibration };
    if (value === undefined) delete next[metric];
    else Object.assign(next, { [metric]: value });
    return next;
  }

  const latest = series.at(-1) ?? current;
  return (
    <View style={styles.root}>
      <View style={styles.readingRow}>
        <View><Text style={styles.caption}>CURRENT</Text><Text style={styles.current}>{latest?.value ?? "—"} {latest?.unit}</Text></View>
        <View><Text style={styles.caption}>FILTERED RAW</Text><Text style={styles.raw}>{raw?.value ?? "—"} {raw?.unit}</Text></View>
        <View><Text style={styles.caption}>RAW PROBE</Text><Text style={styles.raw}>{instantaneous?.value ?? "—"} {instantaneous?.unit}</Text></View>
      </View>

      <Text style={styles.sectionTitle}>Last 24 Hours</Text>
      <LineGraph color={colors[metric]} measurements={series} width={graphWidth} onWidth={setGraphWidth} />

      <Text style={styles.sectionTitle}>Calibration</Text>
      {metric === "temperature" ? <View style={styles.calibrationCard}>
        <Text style={styles.help}>Enter the difference needed to match a trusted thermometer.</Text>
        <View style={styles.inline}>
          <Pressable style={styles.step} onPress={() => setTemperatureOffset(formatCalibrationNumber(String((Number(temperatureOffset) || 0) - 0.1), true))}><Text style={styles.stepText}>−</Text></Pressable>
          <TextInput keyboardType="numbers-and-punctuation" maxLength={6} onBlur={() => setTemperatureOffset(formatCalibrationNumber(temperatureOffset, true))} style={styles.input} value={temperatureOffset} onChangeText={(value) => setTemperatureOffset(sanitizeCalibrationNumber(value, true))} />
          <Text style={styles.unit}>°F</Text>
          <Pressable style={styles.step} onPress={() => setTemperatureOffset(formatCalibrationNumber(String((Number(temperatureOffset) || 0) + 0.1), true))}><Text style={styles.stepText}>+</Text></Pressable>
          <Action label="Apply" disabled={busy} onPress={() => void save(withMetric({ offset: Number(temperatureOffset) || 0, calibratedAt: new Date().toISOString() }))} />
        </View>
      </View> : null}
      {metric === "ph" ? <View style={styles.calibrationCard}>
        <Text style={styles.help}>Rinse the probe, place it in a stable calibration solution, then capture that point. Use at least two points.</Text>
        <View style={styles.actions}>{([4, 7, 10] as const).map((reference) => <Action key={reference} label={`Capture ${reference.toFixed(2)}`} disabled={busy} onPress={() => capturePh(reference)} />)}</View>
        <Text style={styles.status}>{stabilityStatus(stability)} · {calibration.ph?.points.length ?? 0} of 3 points captured</Text>
      </View> : null}
      {metric === "orp" ? <View style={styles.calibrationCard}>
        <Text style={styles.help}>Place the probe in a stable ORP reference solution, then capture its certified value.</Text>
        <View style={styles.actions}>{([256, 400] as const).map((reference) => <Action key={reference} label={`Capture ${reference} mV`} disabled={busy || !raw || !stableForCapture} onPress={() => raw && void save(withMetric({ offset: reference - raw.value, reference, calibratedAt: new Date().toISOString() }))} />)}</View>
        <Text style={styles.status}>{stabilityStatus(stability)}</Text>
      </View> : null}
      {metric === "salinity" ? <View style={styles.calibrationCard}>
        <Text style={styles.help}>Use a certified 35.00 ppt conductivity standard when possible. A calibrated refractometer or laboratory meter can be entered as a reference.</Text>
        <View style={styles.inline}>
          <TextInput keyboardType="decimal-pad" maxLength={5} onBlur={() => setSalinityReference(formatCalibrationNumber(salinityReference))} style={styles.input} value={salinityReference} onChangeText={(value) => setSalinityReference(sanitizeCalibrationNumber(value))} />
          <Text style={styles.unit}>ppt</Text>
          <Action label="Match Reference" disabled={busy || !raw || !stableForCapture || raw.value <= 0 || Number(salinityReference) <= 0} onPress={() => raw && raw.value > 0 && void save(withMetric({ scale: Number(salinityReference) / raw.value, reference: Number(salinityReference), calibratedAt: new Date().toISOString() }))} />
        </View>
        <Text style={styles.status}>{stabilityStatus(stability)}</Text>
      </View> : null}
      {calibration[metric] ? <Pressable disabled={busy} onPress={() => void save(withMetric(undefined))}><Text style={styles.reset}>Reset {rule.label} calibration</Text></Pressable> : null}
      {calibrationSaved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>Saved</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Alarm Rule</Text>
      <View style={styles.alarmCard}>
        <View style={styles.ruleHeading}><Text style={styles.ruleLabel}>{rule.label}</Text><Pressable accessibilityLabel={`${rule.enabled ? "Disable" : "Enable"} ${rule.label} alarm`} accessibilityRole="switch" accessibilityState={{ checked: rule.enabled, disabled: alarmSaving }} disabled={alarmSaving} onPress={() => void persistAlarmRule(toggledWaterAlarmRule(rule))} style={[styles.toggle, rule.enabled && styles.toggleOn, alarmSaving && styles.disabled]}><Text style={styles.toggleText}>{rule.enabled ? "ON" : "OFF"}</Text></Pressable></View>
        <View style={styles.inline}>
          <View style={styles.field}><Text style={styles.caption}>LOW</Text><TextInput keyboardType="numbers-and-punctuation" onChangeText={setAlarmLower} style={styles.input} value={alarmLower} /></View>
          <View style={styles.field}><Text style={styles.caption}>HIGH</Text><TextInput keyboardType="numbers-and-punctuation" onChangeText={setAlarmUpper} style={styles.input} value={alarmUpper} /></View>
          <Text style={styles.unit}>{rule.unit}</Text>
          <View style={styles.rangeActions}>
            <Pressable accessibilityLabel={`Save ${rule.label} alarm range`} accessibilityRole="button" disabled={alarmSaving} onPress={saveAlarmRange} style={[styles.rangeAction, alarmSaving && styles.disabled]}><Text style={styles.rangeSave}>{alarmSaving ? "…" : "✓"}</Text></Pressable>
            <Pressable accessibilityLabel={`Cancel ${rule.label} alarm range changes`} accessibilityRole="button" disabled={alarmSaving} onPress={cancelAlarmRange} style={[styles.rangeAction, alarmSaving && styles.disabled]}><Text style={styles.rangeCancel}>×</Text></Pressable>
          </View>
        </View>
        {alarmSaved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>Saved</Text> : null}
        {alarmError ? <Text style={styles.error}>{alarmError}</Text> : null}
      </View>
    </View>
  );
}

function stabilityStatus(stability: WaterMeasurementStability | undefined): string {
  if (!stability || stability.sampleCount < 6) return "Stabilizing…";
  return stability.stable ? "Ready to capture" : "Reading is still moving";
}

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}><Text style={styles.actionText}>{label}</Text></Pressable>;
}

function LineGraph({ measurements, color, width, onWidth }: { measurements: WaterMeasurement[]; color: string; width: number; onWidth: (width: number) => void }) {
  const height = 150;
  const padding = 18;
  const values = measurements.map((item) => item.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const range = Math.max(max - min, 0.01);
  const now = Date.now();
  const start = now - 86_400_000;
  const points = measurements.map((item) => ({
    x: padding + Math.max(0, Math.min(1, (Date.parse(item.measuredAt) - start) / 86_400_000)) * (width - padding * 2),
    y: padding + (max - item.value) / range * (height - padding * 2),
  }));
  return <View onLayout={(event) => onWidth(event.nativeEvent.layout.width)} style={[styles.graph, { height }]}>
    <View style={[styles.grid, { top: height / 2 }]} />
    {points.slice(0, -1).map((point, index) => { const next = points[index + 1]!; const dx = next.x - point.x; const dy = next.y - point.y; const length = Math.sqrt(dx ** 2 + dy ** 2); return <View key={measurements[index]?.id} style={[styles.segment, { backgroundColor: color, left: point.x + dx / 2 - length / 2, top: point.y + dy / 2, width: length, transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }] }]} />; })}
    {points.length === 1 ? <View style={[styles.point, { backgroundColor: color, left: points[0]!.x - 3, top: points[0]!.y - 3 }]} /> : null}
    {measurements.length === 0 ? <Text style={styles.empty}>Collecting measurements…</Text> : <><Text style={styles.max}>{max.toFixed(2)}</Text><Text style={styles.min}>{min.toFixed(2)}</Text><Text style={styles.start}>24 HOURS AGO</Text><Text style={styles.end}>NOW</Text></>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 }, readingRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#071D33", borderRadius: 12, padding: 14 }, caption: { color: "#64809A", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 }, current: { color: "#FFF", fontSize: 28, fontWeight: "800", marginTop: 4 }, raw: { color: "#8FA4BF", fontSize: 18, fontWeight: "700", marginTop: 8 }, sectionTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", marginTop: 8 }, graph: { backgroundColor: "#071D33", borderColor: "#153E63", borderRadius: 12, borderWidth: 1, overflow: "hidden", position: "relative", width: "100%" }, grid: { backgroundColor: "#153E63", height: 1, left: 12, position: "absolute", right: 12 }, segment: { height: 2, position: "absolute" }, point: { borderRadius: 3, height: 6, position: "absolute", width: 6 }, empty: { color: "#64809A", marginTop: 65, textAlign: "center" }, min: { bottom: 20, color: "#64809A", fontSize: 9, left: 5, position: "absolute" }, max: { color: "#64809A", fontSize: 9, left: 5, position: "absolute", top: 5 }, start: { bottom: 5, color: "#64809A", fontSize: 8, left: 10, position: "absolute" }, end: { bottom: 5, color: "#64809A", fontSize: 8, position: "absolute", right: 10 }, calibrationCard: { backgroundColor: "#0A2949", borderColor: "#153E63", borderRadius: 12, borderWidth: 1, gap: 10, padding: 14 }, help: { color: "#8FA4BF", fontSize: 12, lineHeight: 18 }, inline: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: 8 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, action: { backgroundColor: "#0B78B8", borderRadius: 8, paddingHorizontal: 13, paddingVertical: 10 }, actionText: { color: "#FFF", fontSize: 11, fontWeight: "800" }, disabled: { opacity: 0.4 }, step: { alignItems: "center", backgroundColor: "#123E63", borderRadius: 8, height: 40, justifyContent: "center", width: 40 }, stepText: { color: "#FFF", fontSize: 22 }, input: { backgroundColor: "#061A2D", borderColor: "#245274", borderRadius: 8, borderWidth: 1, color: "#FFF", minWidth: 82, paddingHorizontal: 10, paddingVertical: 9 }, unit: { color: "#8FA4BF", paddingBottom: 11 }, status: { color: "#64809A", fontSize: 11 }, reset: { color: "#F87171", fontSize: 12, fontWeight: "700", textAlign: "center" }, error: { color: "#F87171", fontSize: 12 }, saved: { color: "#2ECC71", fontSize: 12, fontWeight: "800" }, alarmCard: { backgroundColor: "#0A2949", borderColor: "#153E63", borderRadius: 12, borderWidth: 1, gap: 12, padding: 14 }, ruleHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, ruleLabel: { color: "#FFF", fontSize: 14, fontWeight: "800" }, toggle: { backgroundColor: "#15324B", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 }, toggleOn: { backgroundColor: "#0A6B4A" }, toggleText: { color: "#FFF", fontSize: 10, fontWeight: "900" }, field: { gap: 4 }, rangeActions: { alignItems: "center", flexDirection: "row", gap: 2 }, rangeAction: { alignItems: "center", height: 40, justifyContent: "center", width: 40 }, rangeSave: { color: "#2ECC71", fontSize: 22, fontWeight: "800", lineHeight: 28 }, rangeCancel: { color: "#E74C3C", fontSize: 24, lineHeight: 30 },
});
