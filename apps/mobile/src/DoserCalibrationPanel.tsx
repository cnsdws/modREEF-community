import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { DoserCalibration, Equipment } from "@modreef/digital-twin";

import {
  runEdgeDoserCalibration,
  setEdgeDoserCalibration,
} from "./edgeClient";

interface Props {
  equipment: Equipment;
  aquariumName: string;
  controllerName: string;
  onUpdated(equipment: Equipment): void;
  runCalibrationCommand?: (
    equipmentId: string,
    runtimeSeconds: 60 | 300 | 600,
  ) => Promise<Equipment>;
  saveCalibration?: (equipmentId: string, calibration: DoserCalibration) => Promise<Equipment>;
}

export function DoserCalibrationPanel({
  equipment,
  aquariumName,
  controllerName,
  onUpdated,
  runCalibrationCommand = runEdgeDoserCalibration,
  saveCalibration: saveCalibrationCommand = setEdgeDoserCalibration,
}: Props) {
  const calibration = equipment.doserCalibration;
  const overdue = calibration
    ? Date.parse(calibration.dueAt) <= Date.now()
    : false;
  const [measuredMilliliters, setMeasuredMilliliters] = useState("");
  const [runtimeSeconds, setRuntimeSeconds] = useState<60 | 300 | 600>(60);
  const [months, setMonths] = useState<6 | 12>(
    equipment.doserCalibration?.recalibrationMonths ?? 6,
  );
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState(!calibration || overdue);

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), 5_000);
    return () => clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    setMonths(equipment.doserCalibration?.recalibrationMonths ?? 6);
    setEditing(!equipment.doserCalibration || overdue);
  }, [
    equipment.id,
    equipment.doserCalibration?.recalibrationMonths,
    equipment.doserCalibration?.dueAt,
    overdue,
  ]);

  async function runCalibration() {
    setRunning(true);
    setError(null);
    setSuccess(null);

    try {
      onUpdated(await runCalibrationCommand(equipment.id, runtimeSeconds));
      setSuccess(
        `Calibration run started on ${aquariumName}. Confirmed by ${controllerName}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  async function saveCalibration() {
    const collectedAmount = Number(measuredMilliliters);

    if (!Number.isFinite(collectedAmount) || collectedAmount <= 0) {
      setError(`Enter the amount collected during the ${runtimeSeconds / 60}-minute run.`);
      return;
    }

    const millilitersPerMinute = collectedAmount / (runtimeSeconds / 60);

    const calibratedAt = new Date();
    const dueAt = new Date(calibratedAt);
    dueAt.setUTCMonth(dueAt.getUTCMonth() + months);
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await saveCalibrationCommand(equipment.id, {
        millilitersPerMinute,
        calibratedAt: calibratedAt.toISOString(),
        recalibrationMonths: months,
        dueAt: dueAt.toISOString(),
      });
      setMeasuredMilliliters("");
      setEditing(false);
      onUpdated(updated);
      setSuccess(
        `Calibration saved to ${aquariumName}. Confirmed by ${controllerName}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  if (calibration && !overdue && !editing) {
    return (
      <View style={styles.panel}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCopy}>
            <Text style={styles.title}>Doser Calibration</Text>
            <Text style={styles.status}>
              {calibration.millilitersPerMinute} mL/min · Due {new Date(calibration.dueAt).toLocaleDateString()}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setError(null);
              setEditing(true);
            }}
            style={styles.recalibrateButton}
          >
            <Text style={styles.buttonText}>Recalibrate</Text>
          </Pressable>
        </View>
        {success ? <Text style={styles.success}>{success}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Doser Calibration</Text>
      <Text style={styles.instructions}>
        Prime the line, place it in a graduated cylinder, then choose a test duration. Longer runs average out startup variation and improve accuracy. The doser remains OFF afterward.
      </Text>

      {calibration ? (
        <Text style={[styles.status, overdue ? styles.warning : undefined]}>
          {calibration.millilitersPerMinute} mL/min · {overdue ? "CALIBRATION DUE" : `Due ${new Date(calibration.dueAt).toLocaleDateString()}`}
        </Text>
      ) : (
        <Text style={styles.warning}>Calibration required before saving a volume-based schedule.</Text>
      )}

      <Text style={styles.label}>TEST DURATION</Text>
      <View style={styles.choices}>
        {([60, 300, 600] as const).map((value) => (
          <Pressable
            key={value}
            disabled={running || saving}
            onPress={() => setRuntimeSeconds(value)}
            style={[
              styles.choice,
              runtimeSeconds === value ? styles.choiceSelected : undefined,
            ]}
          >
            <Text style={styles.buttonText}>{value / 60} min</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={running || saving}
        onPress={() => void runCalibration()}
        style={styles.runButton}
      >
        <Text style={styles.buttonText}>
          {running
            ? `Running ${runtimeSeconds / 60} minute${runtimeSeconds === 60 ? "" : "s"}...`
            : `Run ${runtimeSeconds / 60}-Minute Calibration`}
        </Text>
      </Pressable>

      <Text style={styles.label}>MEASURED AMOUNT</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={setMeasuredMilliliters}
        placeholder={`Total mL collected in ${runtimeSeconds / 60} min`}
        placeholderTextColor="#66818C"
        style={styles.input}
        value={measuredMilliliters}
      />

      <Text style={styles.label}>RECALIBRATE</Text>
      <View style={styles.choices}>
        {([6, 12] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setMonths(value)}
            style={[styles.choice, months === value ? styles.choiceSelected : undefined]}
          >
            <Text style={styles.buttonText}>{value} months</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={running || saving}
        onPress={() => void saveCalibration()}
        style={styles.saveButton}
      >
        <Text style={styles.buttonText}>{saving ? "Saving..." : "Save Calibration"}</Text>
      </Pressable>
      {calibration && !overdue ? (
        <Pressable
          disabled={running || saving}
          onPress={() => {
            setMeasuredMilliliters("");
            setError(null);
            setEditing(false);
          }}
          style={styles.cancelButton}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
      ) : null}
      {success ? <Text style={styles.success}>{success}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderColor: "#164975", borderRadius: 14, borderWidth: 1, marginTop: 18, padding: 14 },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  summaryRow: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  summaryCopy: { flex: 1 },
  instructions: { color: "#A8B8C8", fontSize: 11, lineHeight: 17, marginTop: 6 },
  status: { color: "#20B7EC", fontSize: 11, fontWeight: "700", marginTop: 10 },
  warning: { color: "#F4B942", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 10 },
  runButton: { alignItems: "center", backgroundColor: "#133A67", borderRadius: 10, marginTop: 14, paddingVertical: 12 },
  label: { color: "#8298B4", fontSize: 10, fontWeight: "800", marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: "#061528", borderColor: "#164975", borderRadius: 9, borderWidth: 1, color: "#FFFFFF", fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  choices: { flexDirection: "row", gap: 10 },
  choice: { alignItems: "center", backgroundColor: "#2D3542", borderRadius: 9, flex: 1, paddingVertical: 10 },
  choiceSelected: { backgroundColor: "#0A8FEA" },
  saveButton: { alignItems: "center", backgroundColor: "#0A8FEA", borderRadius: 10, marginTop: 14, paddingVertical: 12 },
  recalibrateButton: { alignItems: "center", backgroundColor: "#133A67", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10 },
  cancelButton: { alignItems: "center", backgroundColor: "#2D3542", borderRadius: 10, marginTop: 8, paddingVertical: 12 },
  buttonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  success: { color: "#2ECC71", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 8 },
  error: { color: "#E74C3C", fontSize: 11, lineHeight: 16, marginTop: 8 },
});
