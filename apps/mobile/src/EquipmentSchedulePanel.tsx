import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { Equipment, EquipmentSchedule } from "@modreef/digital-twin";

import { setEdgeEquipmentSchedule } from "./edgeClient";

const days = ["S", "M", "T", "W", "T", "F", "S"];
const allDays = [0, 1, 2, 3, 4, 5, 6];
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Props {
  equipment: Equipment;
  aquariumName: string;
  controllerName: string;
  onUpdated(equipment: Equipment): void;
  saveSchedule?: (equipmentId: string, schedule: EquipmentSchedule) => Promise<Equipment>;
}

export function EquipmentSchedulePanel({
  equipment,
  aquariumName,
  controllerName,
  onUpdated,
  saveSchedule = setEdgeEquipmentSchedule,
}: Props) {
  const scheduledOn = equipment.schedule?.events.find(
    (event) => event.desiredEnabled,
  );
  const scheduledOff = equipment.schedule?.events.find(
    (event) => !event.desiredEnabled,
  );

  const [enabled, setEnabled] = useState(
    equipment.schedule?.enabled ?? false,
  );
  const [weekdays, setWeekdays] = useState(
    scheduledOn?.weekdays ?? allDays,
  );
  const [onTime, setOnTime] = useState(
    scheduledOn?.time ?? "08:00",
  );
  const [offTime, setOffTime] = useState(
    scheduledOff?.time ?? "20:00",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!success) return;
    const timeout = setTimeout(() => setSuccess(null), 5_000);
    return () => clearTimeout(timeout);
  }, [success]);

  useEffect(() => {
    setEnabled(equipment.schedule?.enabled ?? false);
    setWeekdays(scheduledOn?.weekdays ?? allDays);
    setOnTime(scheduledOn?.time ?? "08:00");
    setOffTime(scheduledOff?.time ?? "20:00");
  }, [equipment.id]);

  function toggleWeekday(weekday: number) {
    setWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((value) => value !== weekday)
        : [...current, weekday].sort(),
    );
  }

  async function toggleEnabled() {
    const nextEnabled = !enabled;

    if (
      weekdays.length === 0 ||
      !validTime.test(onTime) ||
      !validTime.test(offTime)
    ) {
      setError("Choose at least one day and use HH:MM times.");
      return;
    }

    setEnabled(nextEnabled);
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await saveSchedule(
        equipment.id,
        {
          enabled: nextEnabled,
          events: [
            {
              id: `${equipment.id}-on`,
              weekdays,
              time: onTime,
              desiredEnabled: true,
            },
            {
              id: `${equipment.id}-off`,
              weekdays,
              time: offTime,
              desiredEnabled: false,
            },
          ],
        },
      );

      onUpdated(updated);
      setSuccess(
        `Schedule saved to ${aquariumName}. Confirmed by ${controllerName}.`,
      );
    } catch (caught) {
      setEnabled(!nextEnabled);
      setError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (
      weekdays.length === 0 ||
      !validTime.test(onTime) ||
      !validTime.test(offTime)
    ) {
      setError("Choose at least one day and use HH:MM times.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updated = await saveSchedule(
        equipment.id,
        {
          enabled,
          events: [
            {
              id: `${equipment.id}-on`,
              weekdays,
              time: onTime,
              desiredEnabled: true,
            },
            {
              id: `${equipment.id}-off`,
              weekdays,
              time: offTime,
              desiredEnabled: false,
            },
          ],
        },
      );

      onUpdated(updated);
      setSuccess(
        `Schedule saved to ${aquariumName}. Confirmed by ${controllerName}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>AUTO Schedule</Text>
          <Text style={styles.summary}>
            Uses the Reef Controller&apos;s local time
          </Text>
        </View>

        <Pressable
          disabled={saving}
          onPress={() => void toggleEnabled()}
          style={[
            styles.toggle,
            enabled ? styles.toggleEnabled : undefined,
          ]}
        >
          <Text style={styles.toggleText}>
            {saving
              ? "SAVING..."
              : enabled
                ? "ENABLED"
                : "DISABLED"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.days}>
        {days.map((label, weekday) => {
          const selected = weekdays.includes(weekday);

          return (
            <Pressable
              key={weekday}
              onPress={() => toggleWeekday(weekday)}
              style={[
                styles.day,
                selected ? styles.daySelected : undefined,
              ]}
            >
              <Text
                style={[
                  styles.dayText,
                  selected ? styles.dayTextSelected : undefined,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.times}>
        <View style={styles.timeGroup}>
          <Text style={styles.label}>ON</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={5}
            onChangeText={setOnTime}
            placeholder="08:00"
            placeholderTextColor="#62758E"
            style={styles.timeInput}
            value={onTime}
          />
        </View>

        <View style={styles.timeGroup}>
          <Text style={styles.label}>OFF</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={5}
            onChangeText={setOffTime}
            placeholder="20:00"
            placeholderTextColor="#62758E"
            style={styles.timeInput}
            value={offTime}
          />
        </View>
      </View>

      <Pressable
        disabled={saving}
        onPress={() => void save()}
        style={[
          styles.saveButton,
          saving ? styles.disabled : undefined,
        ]}
      >
        <Text style={styles.saveText}>
          {saving ? "Saving..." : "Save Schedule"}
        </Text>
      </Pressable>

      {success ? <Text style={styles.success}>{success}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderColor: "#164975",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 18,
    padding: 14,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  summary: {
    color: "#8298B4",
    fontSize: 11,
    marginTop: 3,
  },
  toggle: {
    backgroundColor: "#2D3542",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  toggleEnabled: {
    backgroundColor: "#133A67",
  },
  toggleText: {
    color: "#E9F2F5",
    fontSize: 9,
    fontWeight: "800",
  },
  days: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  day: {
    alignItems: "center",
    borderColor: "#164975",
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  daySelected: {
    backgroundColor: "#0A8FEA",
    borderColor: "#20B7EC",
  },
  dayText: {
    color: "#8298B4",
    fontSize: 11,
    fontWeight: "700",
  },
  dayTextSelected: {
    color: "#FFFFFF",
  },
  times: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  timeGroup: {
    flex: 1,
  },
  label: {
    color: "#8298B4",
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 6,
  },
  timeInput: {
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 9,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 10,
    marginTop: 14,
    paddingVertical: 12,
  },
  saveText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.5,
  },
  success: {
    color: "#2ECC71",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 8,
  },
  error: {
    color: "#E74C3C",
    fontSize: 11,
    marginTop: 8,
  },
});
