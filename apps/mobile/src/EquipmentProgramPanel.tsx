import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  DosingParameter,
  Equipment,
  EquipmentProgramType,
} from "@modreef/digital-twin";

import { DoserCalibrationPanel } from "./DoserCalibrationPanel";
import { AdvancedOutletProgramPanel } from "./AdvancedOutletProgramPanel";
import { EquipmentIntervalProgramPanel } from "./EquipmentIntervalProgramPanel";
import { EquipmentSchedulePanel } from "./EquipmentSchedulePanel";
import {
  runDashboardDoserCalibration,
  setDashboardDoserCalibration,
  setDashboardEquipmentIntervalProgram,
  setDashboardAdvancedOutletProgram,
  setDashboardEquipmentSchedule,
  setDashboardEquipmentProgramType,
  updateDashboardEquipment,
} from "./dashboardConnection";
import { equipmentProgramChoices } from "./equipmentProgramChoices";
import { PumpSpeedPanel } from "./PumpSpeedPanel";

interface Props {
  equipment: Equipment;
  aquariumName: string;
  controllerName: string;
  cloudMode?: boolean;
  onUpdated(equipment: Equipment): void;
  onTimelineGestureActive?: (active: boolean) => void;
  setProgramType?: (
    equipmentId: string,
    programType: EquipmentProgramType,
  ) => Promise<Equipment>;
}

const dosingParameters: Array<{ parameter: DosingParameter; label: string }> = [
  { parameter: "alkalinity", label: "Alkalinity (Alk)" },
  { parameter: "calcium", label: "Calcium (Ca)" },
  { parameter: "magnesium", label: "Magnesium (Mg)" },
  { parameter: "potassium", label: "Potassium (K)" },
  { parameter: "iodine", label: "Iodine (I)" },
  { parameter: "nitrate", label: "Nitrate (NO₃)" },
  { parameter: "phosphate", label: "Phosphate (PO₄)" },
  { parameter: "iron", label: "Iron (Fe)" },
  { parameter: "other", label: "Other" },
];

function dosingParameterLabel(
  parameter: DosingParameter | undefined,
  customName?: string,
): string {
  if (parameter === "other" && customName) return customName;
  return dosingParameters.find((item) => item.parameter === parameter)?.label ??
    "Select dosing category";
}

function programLabel(type: EquipmentProgramType): string {
  return equipmentProgramChoices.find((choice) => choice.type === type)?.label ?? type;
}

export function EquipmentProgramPanel({
  equipment,
  aquariumName,
  controllerName,
  onUpdated,
  onTimelineGestureActive,
  setProgramType,
}: Props) {
  const programType =
    equipment.programType ??
    (equipment.schedule ? "schedule" : "always-on");
  const isProgramTypeLocked = equipment.programTypeLocked === true;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [programSaving, setProgramSaving] = useState(false);
  const [parameterDropdownOpen, setParameterDropdownOpen] = useState(false);
  const [parameterSaving, setParameterSaving] = useState(false);
  const [customDosingName, setCustomDosingName] = useState(
    equipment.dosingParameterName ?? "",
  );
  const [customDosingOpen, setCustomDosingOpen] = useState(
    equipment.dosingParameter === "other",
  );
  const [restartSavingSeconds, setRestartSavingSeconds] =
    useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 8_000);
    return () => clearTimeout(timeout);
  }, [error]);

  async function setRestartDelay(seconds: number) {
    setRestartSavingSeconds(seconds);
    setError(null);
    try {
      const updated = await updateDashboardEquipment(
        equipment.id,
        equipment.name,
        equipment.role,
        seconds,
      );
      if (updated.automaticRestartDelaySeconds !== seconds) {
        throw new Error(
          "The Reef Controller did not confirm the automatic restart delay. Update the Reef Controller and try again.",
        );
      }
      onUpdated(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestartSavingSeconds(null);
    }
  }

  async function selectProgramType(next: EquipmentProgramType) {
    setDropdownOpen(false);
    if (next === programType) return;

    setProgramSaving(true);
    setError(null);
    try {
      onUpdated(await (setProgramType ?? setDashboardEquipmentProgramType)(equipment.id, next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProgramSaving(false);
    }
  }

  async function selectDosingParameter(
    parameter: DosingParameter,
    dosingParameterName?: string,
  ) {
    setParameterDropdownOpen(false);
    if (parameter === "other" && dosingParameterName === undefined) {
      setCustomDosingOpen(true);
      return;
    }
    if (
      parameter === equipment.dosingParameter &&
      dosingParameterName === equipment.dosingParameterName
    ) return;
    setParameterSaving(true);
    setError(null);
    try {
      const updated = await updateDashboardEquipment(
        equipment.id,
        equipment.name,
        equipment.role,
        equipment.automaticRestartDelaySeconds,
        parameter,
        dosingParameterName,
      );
      if (updated.dosingParameter !== parameter) {
        throw new Error("The Reef Controller did not confirm the measured element.");
      }
      setCustomDosingOpen(parameter === "other");
      onUpdated(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setParameterSaving(false);
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>AUTO Program</Text>
      <Text style={styles.summary}>
        Choose how this equipment behaves in AUTO
      </Text>

      <Text style={styles.fieldLabel}>TYPE</Text>
      {isProgramTypeLocked ? (
        <View style={styles.selector}>
          <Text style={styles.selectorText}>{programLabel(programType)}</Text>
        </View>
      ) : <Pressable
        disabled={programSaving || restartSavingSeconds !== null}
        onPress={() => setDropdownOpen((open) => !open)}
        style={styles.selector}
      >
        <Text style={styles.selectorText}>
          {programSaving ? "Saving..." : programLabel(programType)}
        </Text>
        <Text style={styles.selectorArrow}>{dropdownOpen ? "▲" : "▼"}</Text>
      </Pressable>}

      {!isProgramTypeLocked && dropdownOpen ? (
        <View style={styles.menu}>
          {equipmentProgramChoices.map((choice) => (
            <Pressable
              key={choice.type}
              onPress={() => void selectProgramType(choice.type)}
              style={[
                styles.menuItem,
                choice.type === programType ? styles.menuItemSelected : undefined,
              ]}
            >
              <Text style={styles.menuItemText}>{choice.label}</Text>
              <Text style={styles.choiceDescription}>{choice.description}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {programType === "always-on" ? (
        <Text style={styles.explanation}>
          This equipment remains on whenever its control mode is AUTO.
        </Text>
      ) : null}

      {equipment.binding?.capability === "speed" || equipment.speedPercent !== undefined ? (
        <PumpSpeedPanel
          equipment={equipment}
          onUpdated={onUpdated}
          {...(onTimelineGestureActive ? { onTimelineGestureActive } : {})}
        />
      ) : null}

      {programType === "schedule" || programType === "light-schedule" ? (
        <EquipmentSchedulePanel
          aquariumName={aquariumName}
          controllerName={controllerName}
          equipment={equipment}
          onUpdated={onUpdated}
          saveSchedule={setDashboardEquipmentSchedule}
        />
      ) : null}

      {programType === "dosing-pump" ? (
        <>
          <Text style={styles.fieldLabel}>DOSING CATEGORY</Text>
          <Text style={styles.explanation}>
            Identify what this doser adds to the aquarium.
          </Text>
          <Pressable
            disabled={parameterSaving}
            onPress={() => setParameterDropdownOpen((open) => !open)}
            style={styles.selector}
          >
            <Text style={styles.selectorText}>
              {parameterSaving
                ? "Saving..."
                : dosingParameterLabel(
                    equipment.dosingParameter,
                    equipment.dosingParameterName,
                  )}
            </Text>
            <Text style={styles.selectorArrow}>
              {parameterDropdownOpen ? "▲" : "▼"}
            </Text>
          </Pressable>
          {parameterDropdownOpen ? (
            <View style={styles.menu}>
              {dosingParameters.map((item) => (
                <Pressable
                  key={item.parameter}
                  onPress={() => void selectDosingParameter(item.parameter)}
                  style={[
                    styles.menuItem,
                    item.parameter === equipment.dosingParameter
                      ? styles.menuItemSelected
                      : undefined,
                  ]}
                >
                  <Text style={styles.menuItemText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {customDosingOpen ? (
            <View style={styles.customDosingRow}>
              <TextInput
                accessibilityLabel="Other dosing category name"
                editable={!parameterSaving}
                onChangeText={setCustomDosingName}
                placeholder="Amino Acids or Trace Elements"
                placeholderTextColor="#607A98"
                style={styles.customDosingInput}
                value={customDosingName}
              />
              <Pressable
                disabled={parameterSaving || customDosingName.trim() === ""}
                onPress={() => void selectDosingParameter(
                  "other",
                  customDosingName.trim(),
                )}
                style={styles.customDosingSave}
              >
                <Text style={styles.customDosingSaveText}>Save</Text>
              </Pressable>
            </View>
          ) : null}
          <DoserCalibrationPanel
            aquariumName={aquariumName}
            controllerName={controllerName}
            equipment={equipment}
            onUpdated={onUpdated}
            runCalibrationCommand={runDashboardDoserCalibration}
            saveCalibration={setDashboardDoserCalibration}
          />
          <EquipmentIntervalProgramPanel
            aquariumName={aquariumName}
            controllerName={controllerName}
            equipment={equipment}
            onUpdated={onUpdated}
            saveProgram={setDashboardEquipmentIntervalProgram}
          />
        </>
      ) : null}

      {programType === "advanced" ? (
        <AdvancedOutletProgramPanel
          aquariumName={aquariumName}
          controllerName={controllerName}
          equipment={equipment}
          onUpdated={onUpdated}
          saveProgram={setDashboardAdvancedOutletProgram}
        />
      ) : null}

      {programType === "heater" ? (
        <Text style={styles.explanation}>
          Heater safety thresholds require an assigned temperature sensor. Until configured, this outlet remains safely off in AUTO.
        </Text>
      ) : null}

      {programType === "return-pump" || programType === "skimmer" ? (
        <Text style={styles.explanation}>
          {equipment.binding?.capability === "speed"
            ? "This pump follows its daily speed program in AUTO and runs at 30% during Feed Mode."
            : "This equipment remains on in AUTO and turns off during Feed Mode."}
        </Text>
      ) : null}

      {programType === "skimmer" || equipment.role === "ato" ? (
        <View style={styles.restartPanel}>
          <Text style={styles.fieldLabel}>AUTOMATIC RESTART DELAY</Text>
          <Text style={styles.explanation}>
            Wait after Feed Cycles, Water Changes, and other automatic events before restarting.
          </Text>
          <View style={styles.restartChoices}>
            {[0, 60, 120, 180, 300, 600].map((seconds) => (
              <Pressable
                disabled={programSaving || restartSavingSeconds !== null}
                key={seconds}
                onPress={() => void setRestartDelay(seconds)}
                style={[
                  styles.restartChoice,
                  (equipment.automaticRestartDelaySeconds ?? 0) === seconds
                    ? styles.restartChoiceSelected
                    : undefined,
                ]}
              >
                <Text style={styles.restartChoiceText}>
                  {restartSavingSeconds === seconds
                    ? "Saving…"
                    : seconds === 0 ? "None" : `${seconds / 60}m`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

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
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  summary: { color: "#8298B4", fontSize: 11, marginTop: 3 },
  fieldLabel: {
    color: "#8298B4",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 14,
  },
  selector: {
    alignItems: "center",
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectorText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  selectorArrow: { color: "#20B7EC", fontSize: 11 },
  menu: {
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 4,
    overflow: "hidden",
  },
  menuItem: {
    borderBottomColor: "#164975",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  menuItemSelected: { backgroundColor: "#133A67" },
  customDosingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  customDosingInput: {
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 9,
    borderWidth: 1,
    color: "#FFFFFF",
    flex: 1,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  customDosingSave: {
    backgroundColor: "#0E7CAA",
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  customDosingSaveText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" },
  restartPanel: { marginTop: 12 },
  restartChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  restartChoice: {
    borderColor: "#164975", borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  restartChoiceSelected: { backgroundColor: "#0E7CAA", borderColor: "#20B7EC" },
  restartChoiceText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  choiceDescription: { color: "#8298B4", fontSize: 9, marginTop: 3 },
  menuItemText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  explanation: {
    color: "#AFC1D6",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
  },
  error: { color: "#FF8F8F", fontSize: 11, marginTop: 12 },
});
