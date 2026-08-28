import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { Equipment } from "@modreef/digital-twin";
import { PumpSpeedPanel } from "./PumpSpeedPanel";
import { setDashboardWavemakerConfiguration } from "./dashboardConnection";

const waveModes = [
  { code: "M1", name: "Classic", detail: "Classic pulsing wave pattern." },
  { code: "M2", name: "Sine", detail: "Smoothly varies flow between 30% and 100%." },
  { code: "M3", name: "Constant", detail: "Continuous flow at the selected output." },
  { code: "M4", name: "Random", detail: "Irregular flow changes for varied movement." },
  { code: "M5", name: "Classic Wave Cross Flow", detail: "Classic cross-flow wave pattern." },
] as const;

type WavemakerMode = typeof waveModes[number]["code"];

export function isDmpWavemaker(equipment: Equipment): boolean {
  return equipment.id.startsWith("dmp-") ||
    equipment.physicalDeviceId?.startsWith("dmp-") === true;
}

export function WavemakerProgramPanel({
  equipment,
  wavemakers,
  onUpdated,
  onTimelineGestureActive,
  settingsIcon,
}: {
  equipment: Equipment;
  wavemakers: Equipment[];
  onUpdated(equipment: Equipment): void;
  onTimelineGestureActive?: (active: boolean) => void;
  settingsIcon: ReactNode;
}) {
  const [configurationSaving, setConfigurationSaving] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<WavemakerMode | null>(null);
  const [draftFlow, setDraftFlow] = useState(100);
  const [draftFrequency, setDraftFrequency] = useState(100);
  const linkRole = equipment.wavemakerLinkRole ?? "independent";
  const reportedMode = equipment.wavemakerMode ?? "M3";
  const [modeOverride, setModeOverride] = useState<WavemakerMode | null>(null);
  const selectedMode = modeOverride ?? reportedMode;
  const feedParticipation = equipment.feedCycleParticipation ?? true;
  const latestEquipment = useRef(equipment);
  const queuedMode = useRef<WavemakerMode | null>(null);
  const processingMode = useRef(false);
  const lastConfirmedMode = useRef<WavemakerMode>(reportedMode);

  latestEquipment.current = equipment;

  useEffect(() => {
    if (modeOverride === null || reportedMode !== modeOverride || modeSaving) return;

    // The parent applies our optimistic update immediately, then may briefly
    // deliver an older polling snapshot. Keep the local selection through that
    // window and release it only after the reported mode remains stable.
    const confirmationTimer = setTimeout(() => setModeOverride(null), 3_000);
    return () => clearTimeout(confirmationTimer);
  }, [modeOverride, reportedMode, modeSaving]);

  useEffect(() => {
    if (!processingMode.current && modeOverride === null) {
      lastConfirmedMode.current = reportedMode;
    }
  }, [modeOverride, reportedMode]);
  const otherMaster = wavemakers.find((item) =>
    item.id !== equipment.id && item.wavemakerLinkRole === "master"
  );
  const master = linkRole === "master" ? equipment : otherMaster;
  const saveConfiguration = async (
    participation: boolean,
    role: "independent" | "master" | "slave",
  ) => {
    if (configurationSaving) return;
    setConfigurationSaving(true);
    setError(null);
    const optimisticEquipment: Equipment = {
      ...equipment,
      feedCycleParticipation: participation,
      wavemakerLinkRole: role,
      wavemakerMode: selectedMode,
    };
    onUpdated(optimisticEquipment);
    try {
      onUpdated(await setDashboardWavemakerConfiguration(
        equipment, participation, role, selectedMode, equipment.wavemakerModeSettings,
      ));
    } catch (cause) {
      onUpdated(equipment);
      setError(cause instanceof Error ? cause.message : "Could not save wavemaker configuration");
    } finally {
      setConfigurationSaving(false);
    }
  };

  const selectMode = (mode: WavemakerMode) => {
    setError(null);
    setModeOverride(mode);
    queuedMode.current = mode;
    if (processingMode.current) return;

    processingMode.current = true;
    setModeSaving(true);
    void (async () => {
      try {
        while (queuedMode.current !== null) {
          const nextMode = queuedMode.current;
          queuedMode.current = null;
          const current = latestEquipment.current;
          try {
            const updated = await setDashboardWavemakerConfiguration(
              current,
              current.feedCycleParticipation ?? true,
              current.wavemakerLinkRole ?? "independent",
              nextMode,
              current.wavemakerModeSettings,
            );
            lastConfirmedMode.current = nextMode;
            latestEquipment.current = updated;
            onUpdated(updated);
          } catch (cause) {
            if (queuedMode.current === null) {
              setModeOverride(lastConfirmedMode.current);
              onUpdated({ ...latestEquipment.current, wavemakerMode: lastConfirmedMode.current });
            }
            setError(cause instanceof Error ? cause.message : "Could not change wavemaker mode");
          }
        }
      } finally {
        processingMode.current = false;
        setModeSaving(false);
      }
    })();
  };

  const openModeSettings = (mode: WavemakerMode) => {
    const setting = equipment.wavemakerModeSettings?.[mode];
    setDraftFlow(setting?.flowPercent ?? equipment.speedPercent ?? 100);
    setDraftFrequency(setting?.pulseFrequency ?? 100);
    setEditingMode(mode);
  };

  const saveModeSettings = async () => {
    if (!editingMode || configurationSaving || modeSaving) return;
    const mode = editingMode;
    const modeSettings = {
      ...equipment.wavemakerModeSettings,
      [mode]: {
        flowPercent: draftFlow,
        ...(mode === "M4" ? {} : { pulseFrequency: draftFrequency }),
      },
    };
    setEditingMode(null);
    setModeOverride(mode);
    setConfigurationSaving(true);
    setError(null);
    try {
      const updated = await setDashboardWavemakerConfiguration(
        equipment, feedParticipation, linkRole, mode, modeSettings,
      );
      lastConfirmedMode.current = mode;
      latestEquipment.current = updated;
      onUpdated(updated);
    } catch (cause) {
      setModeOverride(null);
      setError(cause instanceof Error ? cause.message : "Could not save mode settings");
    } finally {
      setConfigurationSaving(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>DMP-40 WAVEMAKER</Text>
      <Text style={styles.title}>Wave Program</Text>
      <Text style={styles.summary}>
        Configure flow character, intensity, timing, and coordinated pumps.
      </Text>

      <Text style={styles.fieldLabel}>LINKED OPERATION</Text>
      <View style={styles.segmentedRow}>
        {(["independent", "master", "slave"] as const).map((role) => {
          const disabled = configurationSaving || (role === "master" && Boolean(otherMaster)) ||
            (role === "slave" && !otherMaster);
          return <Pressable
            accessibilityRole="button"
            disabled={disabled}
            key={role}
            onPress={() => void saveConfiguration(feedParticipation, role)}
            style={[styles.segment, linkRole === role && styles.segmentSelected, disabled && styles.segmentDisabled]}
          >
            <Text style={[styles.segmentText, linkRole === role && styles.segmentTextSelected]}>
              {role[0]!.toUpperCase() + role.slice(1)}
            </Text>
          </Pressable>;
        })}
      </View>
      {otherMaster && linkRole !== "slave" ? (
        <Text style={styles.helpText}>{otherMaster.name} is the master. Set it to Independent before selecting another master.</Text>
      ) : null}
      {linkRole === "slave" && master ? (
        <Text style={styles.helpText}>Flow and Feed Cycle behavior are inherited from {master.name}.</Text>
      ) : null}
      {configurationSaving ? <ActivityIndicator color="#20B7EC" style={styles.saving} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {linkRole !== "slave" ? <>
        <View style={styles.toggleRow}>
          <View style={styles.capabilityCopy}>
            <Text style={styles.capabilityLabel}>Participate in Feed Cycles</Text>
            <Text style={styles.capabilityDetail}>Stops for Feed Cycle A, B, or C and resumes with the active program.</Text>
          </View>
          <Switch
            disabled={configurationSaving}
            onValueChange={(value) => void saveConfiguration(value, linkRole)}
            trackColor={{ false: "#25405A", true: "#087FB1" }}
            thumbColor={feedParticipation ? "#20B7EC" : "#8298B4"}
            value={feedParticipation}
          />
        </View>

        <View style={styles.modeHeading}>
          <Text style={styles.fieldLabel}>WAVE MODES</Text>
          {modeSaving ? <ActivityIndicator color="#20B7EC" size="small" /> : null}
        </View>
        <View style={styles.modeGrid}>
          {waveModes.map((mode) => (
            <Pressable
              accessibilityLabel={`${mode.name} wave mode`}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedMode === mode.code }}
              key={mode.code}
              onPress={() => selectMode(mode.code)}
              style={[styles.modeCard, selectedMode === mode.code && styles.modeCardSelected]}
            >
              <Text style={styles.modeCode}>{mode.code}</Text>
              <Text style={[styles.modeName, selectedMode === mode.code && styles.modeNameSelected]}>{mode.name}</Text>
              <Text style={styles.modeDetail}>{mode.detail}</Text>
              <Pressable
                accessibilityLabel={`Configure ${mode.name}`}
                accessibilityRole="button"
                onPress={(event) => {
                  event.stopPropagation();
                  openModeSettings(mode.code);
                }}
                style={styles.modeGear}
              >
                {Platform.OS === "web" ? (
                  <Text style={styles.modeGearText}>⚙︎</Text>
                ) : (
                  settingsIcon
                )}
              </Pressable>
            </Pressable>
          ))}
        </View>

        <View style={styles.capabilityRows}>
        <CapabilityRow label="Schedule" value="Timed periods" detail="Assign a wave mode to each period" />
        </View>

        <PumpSpeedPanel
          equipment={equipment}
          feedNote="Feed Mode stops this wavemaker, then returns it to the active flow program."
          onUpdated={onUpdated}
          title="Daily flow program"
          {...(onTimelineGestureActive ? { onTimelineGestureActive } : {})}
        />
      </> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setEditingMode(null)}
        transparent
        visible={editingMode !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.eyebrow}>{editingMode} SETTINGS</Text>
            <Text style={styles.modalTitle}>{waveModes.find(({ code }) => code === editingMode)?.name}</Text>
            <ModeSlider label="Flow" min={30} max={100} suffix="%" value={draftFlow} onChange={setDraftFlow} />
            {editingMode !== "M3" && editingMode !== "M4" ? (
              <>
                <PulseWavePreview frequency={draftFrequency} square={editingMode === "M1"} />
                <ModeSlider label="Pulse frequency" min={5} max={100} value={draftFrequency} onChange={setDraftFrequency} />
              </>
            ) : editingMode === "M3" ? (
              <Text style={styles.modalHelp}>Constant mode maintains the selected flow continuously.</Text>
            ) : (
              <Text style={styles.modalHelp}>Random mode varies pulse frequency automatically.</Text>
            )}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setEditingMode(null)} style={styles.modalSecondary}>
                <Text style={styles.modalSecondaryText}>Cancel</Text>
              </Pressable>
              <Pressable disabled={configurationSaving || modeSaving} onPress={() => void saveModeSettings()} style={styles.modalPrimary}>
                <Text style={styles.modalPrimaryText}>Save & Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PulseWavePreview({ frequency, square = false }: { frequency: number; square?: boolean }) {
  const [width, setWidth] = useState(1);
  const pointCount = Math.max(48, Math.round(width / 5));
  const cycles = 1 + ((frequency - 5) / 95) * 6;
  const points: Array<{ key: string; left: number; top: number }> = [];
  let previousTop: number | null = null;

  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / Math.max(1, pointCount - 1);
    const sine = Math.sin(progress * cycles * Math.PI * 2);
    const top = square ? (sine >= 0 ? 15 : 85) : 50 - sine * 35;
    if (square && previousTop !== null && previousTop !== top) {
      for (let step = 1; step < 8; step += 1) {
        points.push({ key: `${index}-step-${step}`, left: progress * 100, top: previousTop + ((top - previousTop) * step) / 8 });
      }
    }
    points.push({ key: `${index}`, left: progress * 100, top });
    previousTop = top;
  }

  return (
    <View
      accessibilityLabel={`${square ? "Square pulse" : "Sine"} waveform preview at frequency ${frequency}`}
      accessibilityRole="image"
      onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      style={styles.wavePreview}
    >
      <View style={styles.waveMidline} />
      {points.map((point) => (
        <View key={point.key} style={[styles.wavePoint, { left: `${point.left}%`, top: `${point.top}%` }]} />
      ))}
    </View>
  );
}

function ModeSlider({ label, min, max, value, suffix = "", onChange }: {
  label: string; min: number; max: number; value: number; suffix?: string;
  onChange(value: number): void;
}) {
  const [width, setWidth] = useState(1);
  const dragStart = useRef({ pageX: 0, value });
  const valueFromLocation = (locationX: number) => {
    const ratio = Math.max(0, Math.min(1, locationX / width));
    return Math.round(min + ratio * (max - min));
  };
  return <View style={styles.sliderGroup}>
    <View style={styles.sliderHeader}>
      <Text style={styles.capabilityLabel}>{label}</Text>
      <Text style={styles.sliderValue}>{value}{suffix}</Text>
    </View>
    <View
      onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        const nextValue = valueFromLocation(event.nativeEvent.locationX);
        dragStart.current = { pageX: event.nativeEvent.pageX, value: nextValue };
        onChange(nextValue);
      }}
      onResponderMove={(event) => {
        const delta = ((event.nativeEvent.pageX - dragStart.current.pageX) / width) * (max - min);
        onChange(Math.max(min, Math.min(max, Math.round(dragStart.current.value + delta))));
      }}
      onResponderTerminationRequest={() => false}
      onStartShouldSetResponder={() => true}
      style={styles.sliderTouchArea}
    >
      <View pointerEvents="none" style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${((value - min) / (max - min)) * 100}%` }]} />
        <View style={[styles.sliderThumb, { left: `${((value - min) / (max - min)) * 100}%` }]} />
      </View>
    </View>
    <View style={styles.sliderBounds}><Text style={styles.modalHelp}>{min}{suffix}</Text><Text style={styles.modalHelp}>{max}{suffix}</Text></View>
  </View>;
}

function CapabilityRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View style={styles.capabilityRow}>
      <View style={styles.capabilityCopy}>
        <Text style={styles.capabilityLabel}>{label}</Text>
        <Text style={styles.capabilityDetail}>{detail}</Text>
      </View>
      <Text style={styles.capabilityValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderColor: "#164975", borderRadius: 14, borderWidth: 1, marginTop: 18, padding: 14 },
  eyebrow: { color: "#20B7EC", fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: "#FFFFFF", fontSize: 17, fontWeight: "800", marginTop: 5 },
  summary: { color: "#8298B4", fontSize: 11, marginTop: 3 },
  fieldLabel: { color: "#8298B4", fontSize: 10, fontWeight: "800", marginTop: 16 },
  modeHeading: { alignItems: "flex-end", flexDirection: "row", gap: 8 },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 7 },
  modeCard: { backgroundColor: "#061528", borderColor: "#164975", borderRadius: 10, borderWidth: 1, flexBasis: "47%", flexGrow: 1, minHeight: 92, padding: 10, paddingRight: 42 },
  modeCardSelected: { backgroundColor: "#08385B", borderColor: "#20B7EC", borderWidth: 2 },
  modeCode: { color: "#20B7EC", fontSize: 9, fontWeight: "900" },
  modeName: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", marginTop: 3 },
  modeNameSelected: { color: "#20B7EC" },
  modeDetail: { color: "#7890AA", fontSize: 9, lineHeight: 13, marginTop: 3 },
  modeGear: { alignItems: "center", height: 34, justifyContent: "center", overflow: "visible", position: "absolute", right: 5, top: 4, width: 34 },
  modeGearText: { color: "#20B7EC", fontSize: 24, includeFontPadding: true, lineHeight: 34, textAlign: "center" },
  capabilityRows: { marginTop: 14 },
  capabilityRow: { alignItems: "center", borderTopColor: "#123657", borderTopWidth: 1, flexDirection: "row", gap: 12, justifyContent: "space-between", paddingVertical: 11 },
  capabilityCopy: { flex: 1 },
  capabilityLabel: { color: "#DCEAF4", fontSize: 11, fontWeight: "800" },
  capabilityDetail: { color: "#718BA5", fontSize: 9, marginTop: 2 },
  capabilityValue: { color: "#20B7EC", fontSize: 10, fontWeight: "800", textAlign: "right" },
  segmentedRow: { flexDirection: "row", gap: 7, marginTop: 7 },
  segment: { alignItems: "center", borderColor: "#1673A4", borderRadius: 9, borderWidth: 1, flex: 1, paddingVertical: 9 },
  segmentSelected: { backgroundColor: "#087FB1" },
  segmentDisabled: { opacity: 0.35 },
  segmentText: { color: "#8BA2B9", fontSize: 10, fontWeight: "800" },
  segmentTextSelected: { color: "#FFFFFF" },
  helpText: { color: "#7890AA", fontSize: 9, lineHeight: 13, marginTop: 7 },
  toggleRow: { alignItems: "center", borderBottomColor: "#123657", borderBottomWidth: 1, flexDirection: "row", gap: 12, justifyContent: "space-between", marginTop: 14, paddingVertical: 11 },
  saving: { marginTop: 8 },
  error: { color: "#FF7B83", fontSize: 9, marginTop: 8 },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(0,8,20,0.82)", flex: 1, justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#071C31", borderColor: "#20B7EC", borderRadius: 16, borderWidth: 1, maxWidth: 480, padding: 20, width: "100%" },
  modalTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "800", marginTop: 5 },
  modalHelp: { color: "#7890AA", fontSize: 10, marginTop: 8 },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 22 },
  modalSecondary: { borderColor: "#22628E", borderRadius: 9, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },
  modalSecondaryText: { color: "#9CB2C7", fontSize: 11, fontWeight: "800" },
  modalPrimary: { backgroundColor: "#087FB1", borderRadius: 9, paddingHorizontal: 18, paddingVertical: 10 },
  modalPrimaryText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  sliderGroup: { marginTop: 20 },
  sliderHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sliderValue: { color: "#20B7EC", fontSize: 13, fontWeight: "900" },
  sliderTouchArea: { height: 34, justifyContent: "center", marginTop: 4 },
  sliderTrack: { backgroundColor: "#17344F", borderRadius: 5, height: 10, position: "relative" },
  sliderFill: { backgroundColor: "#20B7EC", borderRadius: 5, height: 10 },
  sliderThumb: { backgroundColor: "#FFFFFF", borderColor: "#20B7EC", borderRadius: 9, borderWidth: 2, height: 18, marginLeft: -9, position: "absolute", top: -4, width: 18 },
  sliderBounds: { flexDirection: "row", justifyContent: "space-between" },
  wavePreview: { backgroundColor: "#061528", borderColor: "#164975", borderRadius: 10, borderWidth: 1, height: 66, marginTop: 18, overflow: "hidden", position: "relative" },
  waveMidline: { backgroundColor: "#123657", height: 1, left: 0, position: "absolute", right: 0, top: "50%" },
  wavePoint: { backgroundColor: "#20B7EC", borderRadius: 2, height: 4, marginLeft: -2, marginTop: -2, position: "absolute", width: 4 },
});
