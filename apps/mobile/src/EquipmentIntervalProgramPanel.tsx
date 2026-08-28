import { useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  getDosingRuntimeSeconds,
  type Equipment,
  type EquipmentIntervalProgram,
} from "@modreef/digital-twin";

import { setEdgeEquipmentIntervalProgram } from "./edgeClient";
import { durationText, formatTimeInput } from "./dosingScheduleFormatting";

const days = ["S", "M", "T", "W", "T", "F", "S"];
const allDays = [0, 1, 2, 3, 4, 5, 6];
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Props {
  equipment: Equipment;
  aquariumName: string;
  controllerName: string;
  advanced?: boolean;
  onUpdated(equipment: Equipment): void;
  saveProgram?: (equipmentId: string, program: EquipmentIntervalProgram) => Promise<Equipment>;
}

function positiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function positiveNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function EquipmentIntervalProgramPanel({
  equipment,
  aquariumName,
  controllerName,
  advanced = false,
  onUpdated,
  saveProgram = setEdgeEquipmentIntervalProgram,
}: Props) {
  const program = equipment.intervalProgram;
  const [enabled, setEnabled] = useState(program?.enabled ?? false);
  const [startTime, setStartTime] = useState(program?.startTime ?? "00:01");
  const [durationMinutes, setDurationMinutes] = useState(
    String(Math.floor((program?.durationSeconds ?? 100) / 60)),
  );
  const [durationSeconds, setDurationSeconds] = useState(
    String((program?.durationSeconds ?? 100) % 60),
  );
  const [doseMilliliters, setDoseMilliliters] = useState(
    String(program?.doseMilliliters ?? 1),
  );
  const [intervalHours, setIntervalHours] = useState(
    String(Math.floor((program?.intervalSeconds ?? 10_800) / 3600)),
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(Math.floor(((program?.intervalSeconds ?? 10_800) % 3600) / 60)),
  );
  const [weekdays, setWeekdays] = useState(program?.weekdays ?? allDays);
  const [maximumDailyMinutes, setMaximumDailyMinutes] = useState(
    String(Math.ceil((program?.maximumDailyRuntimeSeconds ?? 900) / 60)),
  );
  const [maximumDailyMilliliters, setMaximumDailyMilliliters] = useState(
    String(program?.maximumDailyDoseMilliliters ?? 20),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  function blurInputs(): void {
    for (const input of inputRefs.current) input?.blur();
    Keyboard.dismiss();
  }

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), 5_000);
    return () => clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    const next = equipment.intervalProgram;
    setEnabled(next?.enabled ?? false);
    setStartTime(next?.startTime ?? "00:01");
    setDurationMinutes(String(Math.floor((next?.durationSeconds ?? 100) / 60)));
    setDurationSeconds(String((next?.durationSeconds ?? 100) % 60));
    setDoseMilliliters(String(next?.doseMilliliters ?? 1));
    setIntervalHours(String(Math.floor((next?.intervalSeconds ?? 10_800) / 3600)));
    setIntervalMinutes(
      String(Math.floor(((next?.intervalSeconds ?? 10_800) % 3600) / 60)),
    );
    setWeekdays(next?.weekdays ?? allDays);
    setMaximumDailyMinutes(
      String(Math.ceil((next?.maximumDailyRuntimeSeconds ?? 900) / 60)),
    );
    setMaximumDailyMilliliters(
      String(next?.maximumDailyDoseMilliliters ?? 20),
    );
  }, [equipment.id]);

  const values = useMemo(() => {
    const runMinutes = positiveInteger(durationMinutes);
    const runSeconds = positiveInteger(durationSeconds);
    const everyHours = positiveInteger(intervalHours);
    const everyMinutes = positiveInteger(intervalMinutes);
    const maximumMinutes = positiveInteger(maximumDailyMinutes);
    const dose = positiveNumber(doseMilliliters);
    const maximumDailyDose = positiveNumber(maximumDailyMilliliters);
    const calibrationRate = equipment.doserCalibration?.millilitersPerMinute;
    const calibratedDuration =
      dose !== undefined && equipment.doserCalibration !== undefined
        ? getDosingRuntimeSeconds(equipment.doserCalibration, dose)
        : undefined;

    if (
      runMinutes === undefined ||
      runSeconds === undefined ||
      runSeconds > 59 ||
      everyHours === undefined ||
      everyMinutes === undefined ||
      everyMinutes > 59 ||
      maximumMinutes === undefined ||
      (!advanced &&
        (dose === undefined ||
          maximumDailyDose === undefined ||
          calibratedDuration === undefined))
    ) {
      return undefined;
    }

    return {
      duration: advanced
        ? runMinutes * 60 + runSeconds
        : calibratedDuration!,
      interval: everyHours * 3600 + everyMinutes * 60,
      maximum: advanced
        ? maximumMinutes * 60
        : Math.max(
            calibratedDuration!,
            Math.floor(
              (maximumDailyDose! / calibrationRate!) * 60,
            ),
          ),
      dose,
      maximumDailyDose,
    };
  }, [
    durationMinutes,
    durationSeconds,
    intervalHours,
    intervalMinutes,
    maximumDailyMinutes,
    doseMilliliters,
    maximumDailyMilliliters,
    equipment.doserCalibration?.millilitersPerMinute,
    advanced,
  ]);

  const summary = values && values.duration > 0 && values.interval > 0
    ? advanced
      ? `Normally OFF. Run for ${durationText(values.duration)} every ${durationText(values.interval)}, starting at ${startTime}. If control is lost, turn OFF.`
      : `Dose ${values.dose} mL every ${durationText(values.interval)} (${durationText(values.duration)} runtime), starting at ${startTime}.`
    : "Complete the fields to preview this rule.";

  function toggleWeekday(weekday: number) {
    setWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((value) => value !== weekday)
        : [...current, weekday].sort(),
    );
  }

  async function save(
    nextEnabled = advanced ? enabled : true,
  ) {
    blurInputs();
    if (!advanced && !equipment.doserCalibration) {
      setError("Calibrate this doser before saving a volume-based schedule.");
      return;
    }

    if (
      !values ||
      values.duration < 1 ||
      values.interval <= values.duration ||
      values.maximum < values.duration ||
      !validTime.test(startTime) ||
      weekdays.length === 0
    ) {
      setError(
        "Use a valid start time, choose days, and make the repeat interval and daily limit longer than one run.",
      );
      return;
    }

    const runsPerDay = Math.ceil(86_400 / values.interval);

    if (
      advanced
        ? runsPerDay * values.duration > values.maximum
        : runsPerDay * values.dose! > values.maximumDailyDose!
    ) {
      setError(
        `This rule can run ${runsPerDay} times per day and exceeds the daily safety limit.`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await saveProgram(
        equipment.id,
        {
          enabled: nextEnabled,
          startTime,
          durationSeconds: values.duration,
          ...(!advanced
            ? {
                doseMilliliters: values.dose!,
                maximumDailyDoseMilliliters: values.maximumDailyDose!,
              }
            : {}),
          intervalSeconds: values.interval,
          weekdays,
          fallbackState: "off",
          maximumDailyRuntimeSeconds: values.maximum,
        },
      );
      setEnabled(nextEnabled);
      onUpdated(updated);
      setSuccess(
        `Program saved to ${aquariumName}. Confirmed by ${controllerName}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>
            {advanced ? "Advanced Interval Rule" : "Dosing Schedule"}
          </Text>
          <Text style={styles.summaryLabel}>GUIDED CONFIGURATION</Text>
        </View>
        {advanced ? (
          <Pressable
            disabled={saving}
            onPress={() => void save(!enabled)}
            style={[styles.toggle, enabled ? styles.toggleEnabled : undefined]}
          >
            <Text style={styles.toggleText}>
              {saving ? "SAVING..." : enabled ? "ENABLED" : "DISABLED"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.label}>ACTIVE DAYS</Text>
      <View style={styles.days}>
        {days.map((label, weekday) => {
          const selected = weekdays.includes(weekday);
          return (
            <Pressable
              key={weekday}
              onPress={() => toggleWeekday(weekday)}
              style={[styles.day, selected ? styles.daySelected : undefined]}
            >
              <Text style={[styles.dayText, selected ? styles.dayTextSelected : undefined]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={styles.label}>START (24-HOUR)</Text>
          <TextInput
            ref={(input) => { inputRefs.current[0] = input; }}
            value={startTime}
            onChangeText={(value) => setStartTime(formatTimeInput(value))}
            keyboardType="number-pad"
            maxLength={5}
            placeholder="HH:MM"
            placeholderTextColor="#536A84"
            style={styles.input}
          />
          <Text style={styles.unit}>Type 0930 for 09:30</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{advanced ? "MAX DAILY MIN" : "MAX DAILY ML"}</Text>
          <TextInput
            ref={(input) => { inputRefs.current[1] = input; }}
            value={advanced ? maximumDailyMinutes : maximumDailyMilliliters}
            onChangeText={advanced ? setMaximumDailyMinutes : setMaximumDailyMilliliters}
            keyboardType={advanced ? "number-pad" : "decimal-pad"}
            style={styles.input}
          />
        </View>
      </View>

      {advanced ? (
        <>
          <Text style={styles.label}>RUN FOR</Text>
          <View style={styles.row}>
            <View style={styles.field}>
              <TextInput ref={(input) => { inputRefs.current[2] = input; }} value={durationMinutes} onChangeText={setDurationMinutes} keyboardType="number-pad" style={styles.input} />
              <Text style={styles.unit}>minutes</Text>
            </View>
            <View style={styles.field}>
              <TextInput ref={(input) => { inputRefs.current[3] = input; }} value={durationSeconds} onChangeText={setDurationSeconds} keyboardType="number-pad" style={styles.input} />
              <Text style={styles.unit}>seconds</Text>
            </View>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.label}>DOSE AMOUNT</Text>
          <TextInput ref={(input) => { inputRefs.current[4] = input; }} value={doseMilliliters} onChangeText={setDoseMilliliters} keyboardType="decimal-pad" style={styles.input} />
          <Text style={styles.unit}>milliliters per dose</Text>
        </>
      )}

      <Text style={styles.label}>REPEAT EVERY</Text>
      <View style={styles.row}>
        <View style={styles.field}>
          <TextInput ref={(input) => { inputRefs.current[5] = input; }} value={intervalHours} onChangeText={setIntervalHours} keyboardType="number-pad" style={styles.input} />
          <Text style={styles.unit}>hours</Text>
        </View>
        <View style={styles.field}>
          <TextInput ref={(input) => { inputRefs.current[6] = input; }} value={intervalMinutes} onChangeText={setIntervalMinutes} keyboardType="number-pad" style={styles.input} />
          <Text style={styles.unit}>minutes</Text>
        </View>
      </View>

      <View style={styles.rulePreview}>
        <Text style={styles.ruleLabel}>PLAIN-ENGLISH RULE</Text>
        <Text style={styles.ruleText}>{summary}</Text>
      </View>

      <Pressable
        disabled={saving}
        onPress={() => {
          blurInputs();
          void save();
        }}
        style={styles.saveButton}
      >
        <Text style={styles.saveText}>{saving ? "Saving..." : "Save Program"}</Text>
      </Pressable>

      {success ? <Text style={styles.success}>{success}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderColor: "#164975", borderRadius: 14, borderWidth: 1, marginTop: 18, padding: 14 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  headerCopy: { flex: 1 },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  summaryLabel: { color: "#8298B4", fontSize: 9, fontWeight: "800", marginTop: 3 },
  toggle: { backgroundColor: "#2D3542", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  toggleEnabled: { backgroundColor: "#133A67" },
  toggleText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  label: { color: "#8298B4", fontSize: 10, fontWeight: "800", marginBottom: 6, marginTop: 14 },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { alignItems: "center", borderColor: "#164975", borderRadius: 15, borderWidth: 1, height: 30, justifyContent: "center", width: 30 },
  daySelected: { backgroundColor: "#0A8FEA", borderColor: "#20B7EC" },
  dayText: { color: "#8298B4", fontSize: 11, fontWeight: "700" },
  dayTextSelected: { color: "#FFFFFF" },
  row: { flexDirection: "row", gap: 12 },
  field: { flex: 1 },
  input: { backgroundColor: "#061528", borderColor: "#164975", borderRadius: 9, borderWidth: 1, color: "#FFFFFF", fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  unit: { color: "#8298B4", fontSize: 10, marginTop: 4 },
  rulePreview: { backgroundColor: "#061528", borderColor: "#164975", borderRadius: 9, borderWidth: 1, marginTop: 16, padding: 12 },
  ruleLabel: { color: "#20B7EC", fontSize: 9, fontWeight: "800" },
  ruleText: { color: "#D7E6F4", fontSize: 12, lineHeight: 18, marginTop: 6 },
  saveButton: { alignItems: "center", backgroundColor: "#0A8FEA", borderRadius: 10, marginTop: 14, paddingVertical: 12 },
  saveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  success: { color: "#2ECC71", fontSize: 11, fontWeight: "700", lineHeight: 16, marginTop: 8 },
  error: { color: "#E74C3C", fontSize: 11, lineHeight: 16, marginTop: 8 },
});
