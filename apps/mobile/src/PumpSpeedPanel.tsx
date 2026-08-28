import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import type {
  Equipment,
  EquipmentSpeedSchedule,
  EquipmentSpeedScheduleEvent,
} from "@modreef/digital-twin";
import { setDashboardEquipmentSpeedSchedule } from "./dashboardConnection";

const everyDay = [0, 1, 2, 3, 4, 5, 6];
const minimumSpeed = 30;
const maximumPoints = 24;
const timeSnapMinutes = 15;

type SpeedPoint = Pick<EquipmentSpeedScheduleEvent, "id" | "time" | "speedPercent">;

function initialPoints(equipment: Equipment): SpeedPoint[] {
  const events = equipment.speedSchedule?.events;
  return events?.length
    ? events.map(({ id, time, speedPercent }) => ({ id, time, speedPercent }))
    : [{ id: "all-day", time: "00:00", speedPercent: equipment.speedPercent ?? 60 }];
}

function minutes(time: string): number {
  const [hours = "0", mins = "0"] = time.split(":");
  return Number(hours) * 60 + Number(mins);
}

function timeAt(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(1439, totalMinutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function TrashIcon() {
  return (
    <View accessibilityElementsHidden style={styles.trashGlyph}>
      <View style={styles.trashHandle} />
      <View style={styles.trashLid} />
      <View style={styles.trashCan}>
        <View style={styles.trashSlot} />
        <View style={styles.trashSlot} />
      </View>
    </View>
  );
}

function TimelineLine({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return <View pointerEvents="none" style={[styles.programLine, {
    left: (x1 + x2 - length) / 2,
    top: (y1 + y2) / 2 - 1.5,
    transform: [{ rotate: `${angle}deg` }],
    width: length,
  }]} />;
}

function InteractiveSpeedTimeline({
  points,
  selectedId,
  onChange,
  onDelete,
  onGestureActive,
  onSelect,
}: {
  points: SpeedPoint[];
  selectedId: string | null;
  onChange(points: SpeedPoint[]): void;
  onDelete(id: string): void;
  onGestureActive(active: boolean): void;
  onSelect(id: string): void;
}) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const activePointId = useRef<string | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const sorted = useMemo(
    () => [...points].sort((a, b) => minutes(a.time) - minutes(b.time)),
    [points],
  );

  const xFor = (point: SpeedPoint) => (minutes(point.time) / 1440) * size.width;
  const yFor = (point: SpeedPoint) => ((100 - point.speedPercent) / 70) * size.height;
  const pointFromEvent = (event: GestureResponderEvent) => {
    const x = Math.max(0, Math.min(size.width, event.nativeEvent.locationX));
    const y = Math.max(0, Math.min(size.height, event.nativeEvent.locationY));
    const snappedMinutes = Math.min(
      1425,
      Math.round((x / size.width) * 1440 / timeSnapMinutes) * timeSnapMinutes,
    );
    return {
      time: timeAt(snappedMinutes),
      speedPercent: Math.max(minimumSpeed, Math.min(100, Math.round(100 - (y / size.height) * 70))),
    };
  };

  function nearestPoint(event: GestureResponderEvent): SpeedPoint | undefined {
    const x = event.nativeEvent.locationX;
    const y = event.nativeEvent.locationY;
    return points
      .map((point) => ({ point, distance: Math.hypot(xFor(point) - x, yFor(point) - y) }))
      .sort((a, b) => a.distance - b.distance)
      .find(({ distance }) => distance <= 24)?.point;
  }

  function startGesture(event: GestureResponderEvent) {
    onGestureActive(true);
    const existing = nearestPoint(event);
    if (existing) {
      activePointId.current = existing.id;
      onSelect(existing.id);
      return;
    }
    if (points.length >= maximumPoints) return;
    const position = pointFromEvent(event);
    const point = { id: `speed-${Date.now()}`, ...position };
    const next = [...pointsRef.current, point];
    pointsRef.current = next;
    activePointId.current = point.id;
    onChange(next);
    onSelect(point.id);
  }

  function moveGesture(event: GestureResponderEvent) {
    if (!activePointId.current) return;
    const position = pointFromEvent(event);
    const next = pointsRef.current.map((point) =>
      point.id === activePointId.current ? { ...point, ...position } : point
    );
    pointsRef.current = next;
    onChange(next);
  }

  const layout = (event: LayoutChangeEvent) => setSize(event.nativeEvent.layout);
  const first = sorted[0];
  const last = sorted.at(-1);
  const selected = points.find((point) => point.id === selectedId);
  const midnightSpeed = first && last
    ? last.speedPercent + (first.speedPercent - last.speedPercent) *
      ((1440 - minutes(last.time)) /
        Math.max(1, minutes(first.time) + 1440 - minutes(last.time)))
    : minimumSpeed;

  return (
    <View>
      <View style={styles.timelineContainer}>
        <View
          accessibilityLabel="Interactive 24-hour pump speed timeline"
          onLayout={layout}
          onMoveShouldSetResponder={() => true}
          onMoveShouldSetResponderCapture={() => true}
          onResponderGrant={startGesture}
          onResponderMove={moveGesture}
          onResponderRelease={() => {
            activePointId.current = null;
            onGestureActive(false);
          }}
          onResponderTerminate={() => {
            activePointId.current = null;
            onGestureActive(false);
          }}
          onResponderTerminationRequest={() => false}
          onStartShouldSetResponder={() => true}
          onStartShouldSetResponderCapture={() => true}
          style={styles.timeline}
        >
        {[30, 50, 75, 100].map((speed) => (
          <View key={speed} pointerEvents="none" style={[styles.gridLine, {
            top: `${((100 - speed) / 70) * 100}%`,
          }]} />
        ))}
        {[30, 50, 75, 100].map((speed) => (
          <Text key={`axis-${speed}`} pointerEvents="none" style={[styles.speedAxisLabel, {
            top: `${((100 - speed) / 70) * 100}%`,
          }]}>{speed}%</Text>
        ))}
        {sorted.length === 1 && first ? (
          <TimelineLine x1={0} y1={yFor(first)} x2={size.width} y2={yFor(first)} />
        ) : null}
        {sorted.slice(0, -1).map((point, index) => {
          const next = sorted[index + 1]!;
          return <TimelineLine key={`segment-${point.id}`} x1={xFor(point)} y1={yFor(point)} x2={xFor(next)} y2={yFor(next)} />;
        })}
        {sorted.length > 1 && first && last ? (
          <>
            <TimelineLine
              x1={xFor(last)}
              y1={yFor(last)}
              x2={size.width}
              y2={((100 - midnightSpeed) / 70) * size.height}
            />
            <TimelineLine
              x1={0}
              y1={((100 - midnightSpeed) / 70) * size.height}
              x2={xFor(first)}
              y2={yFor(first)}
            />
          </>
        ) : null}
        {sorted.map((point) => {
          const selected = point.id === selectedId;
          return (
            <View key={point.id} pointerEvents="none" style={[styles.timelinePoint, selected && styles.timelinePointSelected, {
              left: `${(minutes(point.time) / 1440) * 100}%`,
              top: `${((100 - point.speedPercent) / 70) * 100}%`,
            }]}>
              {selected ? <Text style={styles.pointValue}>{point.speedPercent}%</Text> : null}
            </View>
          );
        })}
        </View>
      </View>
      <View style={styles.timelineLabels}>
        {['00', '06', '12', '18', '24'].map((label) => (
          <Text key={label} style={styles.timelineLabel}>{label}</Text>
        ))}
      </View>
      {selected ? (
        <View style={styles.selectedPointBar}>
          <Text style={styles.selectedPointText}>{selected.time} · {selected.speedPercent}%</Text>
          <Pressable
            accessibilityLabel="Delete selected program point"
            disabled={points.length === 1}
            onPress={() => onDelete(selected.id)}
            style={[styles.trashButton, points.length === 1 && styles.buttonDisabled]}
          ><TrashIcon /></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function PumpSpeedPanel({
  equipment,
  onUpdated,
  onTimelineGestureActive = () => undefined,
  title = "Daily pump program",
  feedNote = "Feed Mode temporarily reduces this pump to 30%, then returns it to the active program.",
}: {
  equipment: Equipment;
  onUpdated(equipment: Equipment): void;
  onTimelineGestureActive?: (active: boolean) => void;
  title?: string;
  feedNote?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<SpeedPoint[]>(() => initialPoints(equipment));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const persistedScheduleSignature = JSON.stringify(equipment.speedSchedule ?? null);

  useEffect(() => {
    setPoints(initialPoints(equipment));
    setSelectedId(null);
  }, [equipment.id, persistedScheduleSignature]);
  useEffect(() => () => onTimelineGestureActive(false), [onTimelineGestureActive]);

  async function saveSchedule(enabled: boolean) {
    const uniqueTimes = new Set(points.map((point) => point.time));
    if (points.length === 0 || uniqueTimes.size !== points.length) {
      setError("Move overlapping points to different times before saving.");
      return;
    }
    const next: EquipmentSpeedSchedule = {
      enabled,
      events: [...points]
        .sort((a, b) => minutes(a.time) - minutes(b.time))
        .map((point) => ({ ...point, weekdays: everyDay })),
    };
    setBusy(true);
    setError(null);
    try {
      onUpdated(await setDashboardEquipmentSpeedSchedule(equipment.id, next));
      setSelectedId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const speed = equipment.speedPercent ?? minimumSpeed;
  const enabled = equipment.speedSchedule?.enabled ?? false;
  return (
    <View style={styles.panel}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.hint}>{enabled ? "Running automatically" : "Schedule disabled"}</Text>
        </View>
        <Text style={styles.speed}>{speed}%</Text>
      </View>

      <Text style={styles.instructions}>
        Tap to add a point. Drag a point left/right for time and up/down for speed.
      </Text>
      <InteractiveSpeedTimeline
        onChange={setPoints}
        onDelete={(id) => {
          setPoints((current) => current.filter((point) => point.id !== id));
          setSelectedId(null);
        }}
        onGestureActive={onTimelineGestureActive}
        onSelect={setSelectedId}
        points={points}
        selectedId={selectedId}
      />

      {points.length >= maximumPoints ? <Text style={styles.hint}>Maximum 24 points reached.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={() => void saveSchedule(true)} style={styles.save}>
          <Text style={styles.saveText}>{busy ? "Saving…" : "Save & run daily"}</Text>
        </Pressable>
        {enabled ? (
          <Pressable disabled={busy} onPress={() => void saveSchedule(false)} style={styles.disable}>
            <Text style={styles.saveText}>Disable</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.feedNote}>{feedNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopColor: "#21496E", borderTopWidth: 1, marginTop: 16, paddingTop: 16 },
  headingRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  hint: { color: "#91A4BA", fontSize: 11, marginTop: 3 },
  speed: { color: "#20B7EC", fontSize: 27, fontWeight: "900" },
  instructions: { color: "#91A4BA", fontSize: 11, lineHeight: 16, marginTop: 14 },
  timelineContainer: { marginTop: 12, position: "relative" },
  timeline: { backgroundColor: "#071B2F", borderColor: "#204B70", borderRadius: 10, borderWidth: 1, height: 180, overflow: "hidden", position: "relative" },
  gridLine: { backgroundColor: "#173752", height: 1, left: 0, position: "absolute", right: 0 },
  speedAxisLabel: { color: "#58718C", fontSize: 8, marginTop: 2, position: "absolute", right: 5 },
  programLine: { backgroundColor: "#20B7EC", height: 3, position: "absolute" },
  timelinePoint: { alignItems: "center", backgroundColor: "#20B7EC", borderColor: "#D9F5FF", borderRadius: 8, borderWidth: 2, height: 16, justifyContent: "center", marginLeft: -8, marginTop: -8, position: "absolute", width: 16 },
  timelinePointSelected: { backgroundColor: "#FFFFFF", borderColor: "#20B7EC", borderRadius: 12, height: 24, marginLeft: -12, marginTop: -12, width: 24 },
  pointValue: { color: "#061528", fontSize: 7, fontWeight: "900" },
  timelineLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  timelineLabel: { color: "#6F849F", fontSize: 9 },
  selectedPointBar: { alignItems: "center", alignSelf: "flex-end", flexDirection: "row", marginTop: 4, minHeight: 36 },
  selectedPointText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  trashButton: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  trashGlyph: { alignItems: "center", height: 19, width: 17 },
  trashHandle: { backgroundColor: "#20B7EC", borderRadius: 1, height: 2, width: 7 },
  trashLid: { backgroundColor: "#20B7EC", borderRadius: 1, height: 2, marginTop: 2, width: 17 },
  trashCan: { alignItems: "center", borderColor: "#20B7EC", borderRadius: 2, borderTopWidth: 0, borderWidth: 2, flexDirection: "row", gap: 3, height: 12, justifyContent: "center", width: 13 },
  trashSlot: { backgroundColor: "#20B7EC", borderRadius: 1, height: 6, width: 1.5 },
  buttonDisabled: { opacity: 0.3 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  save: { backgroundColor: "#0A8FEA", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
  disable: { backgroundColor: "#38465A", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11 },
  saveText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  error: { color: "#FF7585", fontSize: 11, marginTop: 10 },
  feedNote: { color: "#91A4BA", fontSize: 10, lineHeight: 15, marginTop: 12 },
});
