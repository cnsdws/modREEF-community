import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  AquariumEvent,
  MeasurementEvent,
  WaterParameter,
} from "@modreef/digital-twin";

import { getDashboardEvents, updateDashboardEvent } from "./dashboardConnection";
import { CircularActionButton } from "./CircularActionButton";
import {
  alkalinityKitForEvent,
  readingIsValid,
} from "./alkalinityTestKits";
import {
  calciumKitForEvent,
  calciumReadingIsValid,
} from "./calciumTestKits";
import {
  magnesiumKitForEvent,
  magnesiumReadingIsValid,
} from "./magnesiumTestKits";
import {
  iodineKitForEvent,
  iodineReadingIsValid,
  iodineResultLabel,
} from "./iodineTestKits";
import {
  ironKitForEvent,
  ironReadingIsValid,
  ironResultLabel,
} from "./ironTestKits";
import {
  nitrateKitForEvent,
  nitrateReadingIsValid,
  nitrateResultLabel,
} from "./nitrateTestKits";
import {
  phosphateKitForEvent,
  phosphateReadingIsValid,
  phosphateResultLabel,
} from "./phosphateTestKits";
import {
  potassiumKitForEvent,
  potassiumReadingIsValid,
  potassiumResultLabel,
} from "./potassiumTestKits";
import { DropdownChevron, FlaskIcon } from "./MeasurementIcons";

const parameters: Array<{
  label: string;
  parameter: WaterParameter;
  color: string;
}> = [
  { label: "Alk", parameter: "alkalinity", color: "#20B7EC" },
  { label: "Ca", parameter: "calcium", color: "#A78BFA" },
  { label: "Mg", parameter: "magnesium", color: "#34D399" },
  { label: "K", parameter: "potassium", color: "#FBBF24" },
  { label: "I", parameter: "iodine", color: "#FB923C" },
  { label: "NO₃", parameter: "nitrate", color: "#20B7EC" },
  { label: "PO₄", parameter: "phosphate", color: "#A78BFA" },
  { label: "Fe", parameter: "iron", color: "#E76F51" },
  { label: "Other", parameter: "other", color: "#20B7EC" },
];

const customColors = [
  "#F472B6",
  "#2DD4BF",
  "#FB7185",
  "#60A5FA",
  "#C084FC",
  "#A3E635",
];

function customParameterKey(name: string): string {
  return `other:${name.trim().toLocaleLowerCase()}`;
}

function customParameterColor(name: string): string {
  const hash = Array.from(name).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return customColors[hash % customColors.length]!;
}

const limits = [20, 50, 100] as const;
const rangePresets = ["1W", "1M", "3M", "1Y", "ALL"] as const;
type RangePreset = (typeof rangePresets)[number];
type RangeSelection = { start: number; end: number };

const dayMilliseconds = 24 * 60 * 60 * 1000;

function localDateParts(isoDate: string): { date: string; time: string } {
  const value = new Date(isoDate);
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

function localDateTime(date: string, time: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;

  const value = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );

  return value.getFullYear() === Number(match[1]) &&
    value.getMonth() === Number(match[2]) - 1 &&
    value.getDate() === Number(match[3]) &&
    value.getHours() === Number(timeMatch[1]) &&
    value.getMinutes() === Number(timeMatch[2])
    ? value
    : null;
}

function retainedRange(now = Date.now()): RangeSelection {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - 24);
  return { start: start.getTime(), end: now };
}

function presetRange(
  preset: RangePreset,
  now = Date.now(),
): RangeSelection {
  if (preset === "ALL") {
    return retainedRange(now);
  }

  const days =
    preset === "1W"
      ? 7
      : preset === "1M"
        ? 30
        : preset === "3M"
          ? 90
          : 365;

  return { start: now - days * dayMilliseconds, end: now };
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function formatAxisValue(value: number, span: number): string {
  const absoluteSpan = Math.abs(span);

  if (absoluteSpan >= 100) {
    return value.toFixed(0);
  }

  if (absoluteSpan >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function RangeNavigator({
  color,
  fullRange,
  selection,
  width,
  onChange,
}: {
  color: string;
  fullRange: RangeSelection;
  selection: RangeSelection;
  width: number;
  onChange: (selection: RangeSelection) => void;
}) {
  const fullSpan = Math.max(1, fullRange.end - fullRange.start);
  const usableWidth = Math.max(1, width - 20);
  const left =
    10 + ((selection.start - fullRange.start) / fullSpan) * usableWidth;
  const right =
    10 + ((selection.end - fullRange.start) / fullSpan) * usableWidth;
  const clamp = (value: number) =>
    Math.min(fullRange.end, Math.max(fullRange.start, value));
  const deltaFor = (dx: number) => (dx / usableWidth) * fullSpan;

  const leftResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gesture) => {
          const start = Math.min(
            selection.end - dayMilliseconds,
            clamp(selection.start + deltaFor(gesture.dx)),
          );
          onChange({ start, end: selection.end });
        },
      }),
    [fullRange.start, fullRange.end, selection.start, selection.end, width],
  );
  const rightResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gesture) => {
          const end = Math.max(
            selection.start + dayMilliseconds,
            clamp(selection.end + deltaFor(gesture.dx)),
          );
          onChange({ start: selection.start, end });
        },
      }),
    [fullRange.start, fullRange.end, selection.start, selection.end, width],
  );
  const windowResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, gesture) => {
          const span = selection.end - selection.start;
          let start = selection.start + deltaFor(gesture.dx);
          start = Math.max(
            fullRange.start,
            Math.min(fullRange.end - span, start),
          );
          onChange({ start, end: start + span });
        },
      }),
    [fullRange.start, fullRange.end, selection.start, selection.end, width],
  );

  return (
    <View style={styles.navigator}>
      <View style={styles.navigatorTrack} />
      <View
        {...windowResponder.panHandlers}
        style={[
          styles.navigatorSelection,
          {
            backgroundColor: color,
            left,
            width: Math.max(12, right - left),
          },
        ]}
      />
      <View
        {...leftResponder.panHandlers}
        style={[styles.navigatorHandle, { borderColor: color, left: left - 8 }]}
      />
      <View
        {...rightResponder.panHandlers}
        style={[styles.navigatorHandle, { borderColor: color, left: right - 8 }]}
      />
    </View>
  );
}

function isMeasurement(
  event: AquariumEvent,
): event is MeasurementEvent {
  return event.type === "measurement";
}

function eventDate(event: MeasurementEvent): string {
  const date = new Date(event.occurredAt);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "2-digit",
        hour: "numeric",
        minute: "2-digit",
      });
}

export function WaterTestsScreen({
  onStartTest,
  refreshVersion = 0,
}: {
  onStartTest: (parameter: WaterParameter, name?: string) => void;
  refreshVersion?: number;
}) {
  const [events, setEvents] = useState<AquariumEvent[]>([]);
  const [limit, setLimit] = useState<(typeof limits)[number]>(20);
  const [visibleMeasurementCount, setVisibleMeasurementCount] =
    useState(20);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [rangeSelections, setRangeSelections] = useState<
    Partial<Record<string, RangeSelection>>
  >({});
  const [selectedPresets, setSelectedPresets] = useState<
    Partial<Record<string, RangePreset>>
  >({});
  const [editingTest, setEditingTest] =
    useState<MeasurementEvent | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSecondaryValue, setEditSecondaryValue] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function beginEdit(event: MeasurementEvent) {
    const occurredAt = localDateParts(event.occurredAt);
    setEditingTest(event);
    setEditValue(
      String(event.testKit?.rawReading ?? event.value),
    );
    setEditSecondaryValue(
      event.testKit?.secondaryRawReading === undefined
        ? ""
        : String(event.testKit.secondaryRawReading),
    );
    setEditNotes(event.notes ?? "");
    setEditDate(occurredAt.date);
    setEditTime(occurredAt.time);
    setEditError(null);
  }

  function closeEdit() {
    if (savingEdit) {
      return;
    }

    setEditingTest(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingTest) {
      return;
    }

    const enteredValue = Number(editValue);
    const alkalinityEventKit = alkalinityKitForEvent(editingTest);
    const calciumEventKit = calciumKitForEvent(editingTest);
    const magnesiumEventKit = magnesiumKitForEvent(editingTest);
    const iodineEventKit = iodineKitForEvent(editingTest);
    const nitrateEventKit = nitrateKitForEvent(editingTest);
    const phosphateEventKit = phosphateKitForEvent(editingTest);
    const ironEventKit = ironKitForEvent(editingTest);
    const potassiumEventKit = potassiumKitForEvent(editingTest);
    const usesAlkalinityReading =
      alkalinityEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesCalciumReading =
      calciumEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesMagnesiumReading =
      magnesiumEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesIodineReading =
      iodineEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesNitrateReading =
      nitrateEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesPhosphateReading =
      phosphateEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesIronReading =
      ironEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const usesPotassiumReading =
      potassiumEventKit !== null &&
      editingTest.testKit?.rawReading !== undefined;
    const secondaryInput =
      calciumEventKit?.secondaryInput ??
      magnesiumEventKit?.secondaryInput ??
      potassiumEventKit?.secondaryInput;
    const enteredSecondaryValue = secondaryInput
      ? Number(editSecondaryValue)
      : undefined;
    const value = usesAlkalinityReading
      ? alkalinityEventKit.calculateDkh(enteredValue)
      : usesCalciumReading
        ? calciumEventKit.calculatePpm(
            enteredValue,
            enteredSecondaryValue,
          )
        : usesMagnesiumReading
          ? magnesiumEventKit.calculatePpm(
              enteredValue,
              enteredSecondaryValue,
            )
          : usesPotassiumReading
            ? potassiumEventKit.calculatePpm(
                enteredValue,
                enteredSecondaryValue,
              )
            : usesIodineReading
              ? iodineEventKit.calculatePpm(enteredValue)
              : usesNitrateReading
                ? nitrateEventKit.calculatePpm(enteredValue)
              : usesPhosphateReading
                ? phosphateEventKit.calculatePpm(enteredValue)
              : usesIronReading
                ? ironEventKit.calculatePpm(enteredValue)
              : enteredValue;
    const occurredAt = localDateTime(editDate, editTime);

    if (
      !Number.isFinite(enteredValue) ||
      (usesAlkalinityReading &&
        !readingIsValid(alkalinityEventKit, enteredValue)) ||
      (usesCalciumReading &&
        !calciumReadingIsValid(
          calciumEventKit,
          enteredValue,
          enteredSecondaryValue,
        )) ||
      (usesMagnesiumReading &&
        !magnesiumReadingIsValid(
          magnesiumEventKit,
          enteredValue,
          enteredSecondaryValue,
        )) ||
      (usesIodineReading &&
        !iodineReadingIsValid(iodineEventKit, enteredValue)) ||
      (usesNitrateReading &&
        !nitrateReadingIsValid(nitrateEventKit, enteredValue)) ||
      (usesPhosphateReading &&
        !phosphateReadingIsValid(phosphateEventKit, enteredValue)) ||
      (usesIronReading &&
        !ironReadingIsValid(ironEventKit, enteredValue)) ||
      (usesPotassiumReading &&
        !potassiumReadingIsValid(
          potassiumEventKit,
          enteredValue,
          enteredSecondaryValue,
        ))
    ) {
      setEditError(
        usesAlkalinityReading
          ? `Enter a ${alkalinityEventKit.inputLabel.toLowerCase()} from ${alkalinityEventKit.minimum.toFixed(alkalinityEventKit.decimals)} to ${alkalinityEventKit.maximum.toFixed(alkalinityEventKit.decimals)}.`
          : usesCalciumReading
            ? "Enter valid calcium kit readings."
            : usesMagnesiumReading
              ? "Enter valid magnesium kit readings."
              : usesIodineReading
                ? "Select a valid iodine kit reading."
                : usesNitrateReading
                  ? "Select a valid nitrate kit reading."
                  : usesPhosphateReading
                    ? "Select a valid phosphate kit reading."
                    : usesIronReading
                      ? "Select a valid iron kit reading."
              : usesPotassiumReading
                ? "Enter valid potassium kit readings."
                : "Enter a valid test result.",
      );
      return;
    }

    if (!occurredAt) {
      setEditError("Enter a valid date and time.");
      return;
    }

    try {
      setSavingEdit(true);
      setEditError(null);
      const updated = await updateDashboardEvent(
        editingTest.id,
        {
          type: "measurement",
          parameter: editingTest.parameter,
          ...(editingTest.name ? { name: editingTest.name } : {}),
          value,
          unit: editingTest.unit,
          source: editingTest.source,
          occurredAt: occurredAt.toISOString(),
          ...(usesAlkalinityReading ||
          usesCalciumReading ||
          usesMagnesiumReading ||
          usesIodineReading ||
          usesNitrateReading ||
          usesPhosphateReading ||
          usesIronReading ||
          usesPotassiumReading
            ? {
                testKit: {
                  ...editingTest.testKit!,
                  rawReading: enteredValue,
                  ...(enteredSecondaryValue === undefined
                    ? {}
                    : { secondaryRawReading: enteredSecondaryValue }),
                },
              }
            : editingTest.testKit
              ? { testKit: editingTest.testKit }
              : {}),
          ...(editNotes.trim()
            ? { notes: editNotes.trim() }
            : {}),
        },
      );

      setEvents((current) =>
        current.map((event) =>
          event.id === updated.id ? updated : event,
        ),
      );
      setEditingTest(null);
    } catch (requestError) {
      setEditError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function refresh() {
    try {
      setLoading(true);
      setEvents(await getDashboardEvents(1000));
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [refreshVersion]);

  const chartParameters = useMemo(() => {
    const builtIn = parameters
      .filter((item) => item.parameter !== "other")
      .map((item, order) => ({
        ...item,
        key: item.parameter,
        order,
        matches: (event: MeasurementEvent) =>
          event.parameter === item.parameter,
      }));
    const custom = new Map<
      string,
      {
        color: string;
        key: string;
        label: string;
        matches: (event: MeasurementEvent) => boolean;
        name: string;
        order: number;
        parameter: WaterParameter;
      }
    >();

    for (const event of events) {
      if (event.type !== "measurement" || event.parameter !== "other") {
        continue;
      }

      const name = event.name?.trim();
      if (!name) continue;
      const key = customParameterKey(name);
      if (!custom.has(key)) {
        custom.set(key, {
          color: customParameterColor(name),
          key,
          label: name,
          matches: (candidate) =>
            candidate.parameter === "other" &&
            candidate.name?.trim().toLocaleLowerCase() ===
              name.toLocaleLowerCase(),
          name,
          order: builtIn.length + custom.size,
          parameter: "other",
        });
      }
    }

    return [...builtIn, ...custom.values()];
  }, [events]);

  const measurementHistory = useMemo(
    () =>
      events
        .filter(isMeasurement)
        .filter((event) =>
          chartParameters.some((item) => item.matches(event)),
        ),
    [chartParameters, events],
  );
  const measurements = measurementHistory.slice(
    0,
    visibleMeasurementCount,
  );

  const chartHeight = 132;
  const chartPadding = 12;
  const yAxisWidth = 62;
  const fullRange = retainedRange();
  const chartSeries = chartParameters
    .map((item) => {
      const allMeasurements = events
        .filter(isMeasurement)
        .filter(item.matches)
        .filter((event) => {
          const timestamp = Date.parse(event.occurredAt);
          return timestamp >= fullRange.start && timestamp <= fullRange.end;
        })
        .sort(
          (left, right) =>
            Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
        );
      const preset = selectedPresets[item.key] ?? "1M";
      const selection =
        rangeSelections[item.key] ?? presetRange(preset);
      const seriesMeasurements = allMeasurements.filter((event) => {
        const timestamp = Date.parse(event.occurredAt);
        return timestamp >= selection.start && timestamp <= selection.end;
      });
      const values = seriesMeasurements.map((event) => event.value);
      const minimum = values.length > 0 ? Math.min(...values) : 0;
      const maximum = values.length > 0 ? Math.max(...values) : 0;
      const average =
        values.length > 0
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : 0;
      const change =
        values.length > 1
          ? values[values.length - 1]! - values[0]!
          : 0;
      const range = maximum - minimum;
      const scalePadding =
        values.length === 0
          ? 1
          : range === 0
            ? Math.max(Math.abs(minimum) * 0.05, 0.1)
            : range * 0.1;
      const scaleMinimum = minimum - scalePadding;
      const scaleMaximum = maximum + scalePadding;
      const scaleRange = Math.max(0.000001, scaleMaximum - scaleMinimum);
      const usableWidth = Math.max(
        0,
        chartWidth - yAxisWidth - chartPadding * 2,
      );
      const selectedSpan = Math.max(1, selection.end - selection.start);
      const points = seriesMeasurements.map((event) => {
        const normalized = (event.value - scaleMinimum) / scaleRange;
        const x =
          yAxisWidth +
          chartPadding +
          ((Date.parse(event.occurredAt) - selection.start) / selectedSpan) *
            usableWidth;
        const y =
          chartPadding +
          (1 - normalized) * (chartHeight - chartPadding * 2);

        return { event, x, y };
      });
      const yTicks = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;

        return {
          label: formatAxisValue(
            scaleMaximum - ratio * scaleRange,
            scaleRange,
          ),
          top:
            chartPadding +
            ratio * (chartHeight - chartPadding * 2),
        };
      });

      return {
        ...item,
        allMeasurements,
        average,
        change,
        maximum,
        minimum,
        points,
        preset,
        selection,
        unit: allMeasurements[allMeasurements.length - 1]?.unit ?? "",
        yTicks,
      };
    })
    .filter((series) => series.allMeasurements.length > 0)
    .sort((left, right) => left.order - right.order);
  const chartHasData = chartSeries.length > 0;

  function choosePreset(
    parameter: string,
    preset: RangePreset,
  ) {
    setSelectedPresets((current) => ({
      ...current,
      [parameter]: preset,
    }));
    setRangeSelections((current) => ({
      ...current,
      [parameter]: presetRange(preset),
    }));
  }

  function chooseCustomRange(
    parameter: string,
    selection: RangeSelection,
  ) {
    setSelectedPresets((current) => {
      const next = { ...current };
      delete next[parameter];
      return next;
    });
    setRangeSelections((current) => ({
      ...current,
      [parameter]: selection,
    }));
  }

  return (
    <View style={styles.screen}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>MEASUREMENTS</Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh water tests"
          accessibilityRole="button"
          onPress={() => void refresh()}
          style={styles.refreshButton}
        >
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>

      <View style={styles.parameterChoices}>
        {parameters.map((item) => {
          return (
            <Pressable
              accessibilityLabel={
                item.parameter === "other"
                  ? "Log custom measurement"
                  : `Log ${item.label} test`
              }
              accessibilityRole="button"
              key={item.parameter}
              onPress={() => onStartTest(item.parameter)}
              style={[
                styles.parameterChoice,
                { borderColor: item.color },
              ]}
            >
              {item.parameter === "other" ? (
                <FlaskIcon />
              ) : (
                <Text
                  style={[
                    styles.parameterText,
                    { color: item.color },
                  ]}
                >
                  {item.label}
                </Text>
              )}
            </Pressable>
          );
        })}
        <Pressable
          accessibilityLabel={detailsOpen ? "Hide test history" : "Show test history"}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen((current) => !current)}
          style={[
            styles.historyToggle,
            detailsOpen ? styles.historyToggleActive : undefined,
          ]}
        >
          <DropdownChevron open={detailsOpen} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.message}>
          <ActivityIndicator color="#20B7EC" />
          <Text style={styles.muted}>Loading test history…</Text>
        </View>
      ) : null}

      {!loading && error ? (
        <Pressable onPress={() => void refresh()} style={styles.message}>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.retry}>Tap to retry</Text>
        </Pressable>
      ) : null}

      {!loading && !error ? (
        <>
          {detailsOpen ? (
          <View style={styles.historyCard}>
                <View style={styles.limitChoices}>
                  {limits.map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      key={item}
                      onPress={() => {
                        setLimit(item);
                        setVisibleMeasurementCount(item);
                      }}
                      style={[
                        styles.limitChoice,
                        limit === item
                          ? styles.limitChoiceActive
                          : undefined,
                      ]}
                    >
                      <Text
                        style={[
                          styles.limitText,
                          limit === item
                            ? styles.limitTextActive
                            : undefined,
                        ]}
                      >
                        {item}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {measurements.map((event, index) => (
                  <Pressable
                    accessibilityLabel={`Edit ${event.parameter} test`}
                    accessibilityRole="button"
                    key={event.id}
                    onPress={() => beginEdit(event)}
                    style={[
                      styles.eventRow,
                      index > 0 ? styles.eventRowBorder : undefined,
                    ]}
                  >
                    <View>
                      {(() => {
                        const definition = chartParameters.find((item) =>
                          item.matches(event),
                        );

                        return (
                          <Text
                            style={[
                              styles.eventValue,
                              definition
                                ? { color: definition.color }
                                : undefined,
                            ]}
                          >
                            {definition?.label ?? event.parameter}: {event.value}{" "}
                            {event.unit}
                          </Text>
                        );
                      })()}
                      <Text style={styles.eventKit}>
                        {event.testKit?.brand ?? "Manual entry"}
                      </Text>
                    </View>
                    <View style={styles.eventRight}>
                      <Text style={styles.eventDate}>
                        {eventDate(event)}
                      </Text>
                      <Text style={styles.rowDisclosure}>›</Text>
                    </View>
                  </Pressable>
                ))}

                {measurements.length === 0 ? (
                  <Text style={styles.empty}>No test history.</Text>
                ) : null}

                {measurements.length < measurementHistory.length ? (
                  <Pressable
                    accessibilityLabel={`Load ${limit} more water tests`}
                    accessibilityRole="button"
                    onPress={() =>
                      setVisibleMeasurementCount((current) =>
                        Math.min(current + limit, measurementHistory.length),
                      )
                    }
                    style={styles.loadMoreButton}
                  >
                    <Text style={styles.loadMoreText}>Load more</Text>
                  </Pressable>
                ) : null}
          </View>
          ) : null}

          {chartHasData ? (
            chartSeries.map((series) => (
              <View key={series.key} style={styles.chartCard}>
                <View style={styles.chartHeading}>
                  <Text style={[styles.chartTitle, { color: series.color }]}>
                    {series.label}
                  </Text>
                  <Text style={styles.chartRange}>
                    {shortDate(series.selection.start)}–{shortDate(series.selection.end)}
                  </Text>
                </View>

                <View style={styles.presetChoices}>
                  {rangePresets.map((preset) => (
                    <Pressable
                      accessibilityRole="button"
                      key={preset}
                      onPress={() => choosePreset(series.key, preset)}
                      style={[
                        styles.presetChoice,
                        series.preset === preset
                          ? { backgroundColor: series.color, borderColor: series.color }
                          : undefined,
                      ]}
                    >
                      <Text
                        style={[
                          styles.presetText,
                          series.preset === preset
                            ? styles.presetTextActive
                            : undefined,
                        ]}
                      >
                        {preset}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View
                  onLayout={(event) =>
                    setChartWidth(event.nativeEvent.layout.width)
                  }
                  style={styles.chart}
                >
                  <View style={styles.yAxis}>
                    {series.yTicks.map((tick, index) => (
                      <Text
                        adjustsFontSizeToFit
                        key={`${tick.label}-${index}`}
                        minimumFontScale={0.8}
                        numberOfLines={1}
                        style={[
                          styles.yAxisLabel,
                          {
                            top: tick.top - 7,
                            width: yAxisWidth - 8,
                          },
                        ]}
                      >
                        {tick.label}
                      </Text>
                    ))}
                  </View>
                  {series.yTicks.map((tick, index) => (
                    <View
                      key={`grid-${tick.label}-${index}`}
                      style={[
                        styles.chartGridLine,
                        {
                          left: yAxisWidth,
                          top: tick.top,
                        },
                      ]}
                    />
                  ))}
                  {series.points.length === 0 ? (
                    <Text style={styles.chartEmpty}>
                      No tests in this date range.
                    </Text>
                  ) : null}
                  {series.points.slice(1).map((point, index) => {
                    const previous = series.points[index];

                    if (!previous) {
                      return null;
                    }

                    const dx = point.x - previous.x;
                    const dy = point.y - previous.y;
                    const length = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx);

                    return (
                      <View
                        key={point.event.id}
                        style={[
                          styles.chartLine,
                          {
                            backgroundColor: series.color,
                            left: previous.x,
                            top: previous.y,
                            width: length,
                            transform: [{ rotateZ: `${angle}rad` }],
                          },
                        ]}
                      />
                    );
                  })}
                  {series.points.map((point) => (
                    <View
                      key={`${point.event.id}-point`}
                      style={[
                        styles.chartPoint,
                        {
                          backgroundColor: series.color,
                          left: point.x - 4,
                          top: point.y - 4,
                        },
                      ]}
                    />
                  ))}
                </View>

                <View style={styles.statistics}>
                  {[
                    ["Min", series.minimum],
                    ["Max", series.maximum],
                    ["Average", series.average],
                    ["Change", series.change],
                  ].map(([label, value]) => (
                    <View key={String(label)} style={styles.statistic}>
                      <Text style={styles.statisticLabel}>{label}</Text>
                      <Text style={styles.statisticValue}>
                        {series.points.length > 0
                          ? `${Number(value).toFixed(2)} ${series.unit}`
                          : "—"}
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.navigatorLabel}>24-month history</Text>
                <RangeNavigator
                  color={series.color}
                  fullRange={fullRange}
                  onChange={(selection) =>
                    chooseCustomRange(series.key, selection)
                  }
                  selection={series.selection}
                  width={chartWidth}
                />
              </View>
            ))
          ) : (
            <View style={styles.chartCard}>
              <View style={styles.chartHeading}>
                <Text style={styles.chartTitle}>Measurement trends</Text>
                <Text style={styles.chartRange}>No data</Text>
              </View>
              <Text style={styles.empty}>
                No chemistry measurements recorded.
              </Text>
            </View>
          )}
        </>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={closeEdit}
        transparent
        visible={editingTest !== null}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView
            contentContainerStyle={styles.editCardContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.editCard}
          >
            <View style={styles.editHeader}>
              <View style={styles.editHeaderCopy}>
                <Text style={styles.editEyebrow}>EDIT TEST</Text>
                <Text style={styles.editTitle}>
                  {editingTest
                    ? chartParameters.find((item) =>
                        item.matches(editingTest),
                      )?.label ?? editingTest.name ?? editingTest.parameter
                    : ""}
                </Text>
              </View>
              <View style={styles.editHeaderActions}>
                <CircularActionButton
                  accessibilityLabel="Cancel changes"
                  disabled={savingEdit}
                  kind="cancel"
                  onPress={closeEdit}
                />
                <CircularActionButton
                  accessibilityLabel="Save water test"
                  busy={savingEdit}
                  disabled={savingEdit || editValue.trim() === ""}
                  kind="confirm"
                  onPress={() => void saveEdit()}
                />
              </View>
            </View>

            <Text style={styles.editLabel}>
              {editingTest &&
              editingTest.testKit?.rawReading !== undefined
                ? (alkalinityKitForEvent(editingTest)?.inputLabel ??
                  calciumKitForEvent(editingTest)?.inputLabel ??
                  magnesiumKitForEvent(editingTest)?.inputLabel ??
                  iodineKitForEvent(editingTest)?.inputLabel ??
                  nitrateKitForEvent(editingTest)?.inputLabel ??
                  phosphateKitForEvent(editingTest)?.inputLabel ??
                  ironKitForEvent(editingTest)?.inputLabel ??
                  potassiumKitForEvent(editingTest)?.inputLabel ??
                  "Kit reading")
                : "Result"}
            </Text>
            <View style={styles.editResultRow}>
              {editingTest &&
              (iodineKitForEvent(editingTest)?.choices ||
                nitrateKitForEvent(editingTest)?.choices ||
                phosphateKitForEvent(editingTest)?.choices ||
                ironKitForEvent(editingTest)?.choices) ? (
                <View style={styles.editReadingChoices}>
                  {(iodineKitForEvent(editingTest)?.choices ??
                    nitrateKitForEvent(editingTest)?.choices ??
                    phosphateKitForEvent(editingTest)?.choices ??
                    ironKitForEvent(editingTest)!.choices!).map((choice) => (
                    <Pressable
                      accessibilityRole="button"
                      key={choice.value}
                      onPress={() => setEditValue(String(choice.value))}
                      style={[
                        styles.editReadingChoice,
                        { backgroundColor: choice.color },
                        Number(editValue) === choice.value
                          ? styles.editReadingChoiceActive
                          : undefined,
                      ]}
                    >
                      <Text
                        style={[
                          styles.editReadingChoiceText,
                          choice.textColor
                            ? { color: choice.textColor }
                            : undefined,
                        ]}
                      >
                        {choice.value}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <TextInput
                  accessibilityLabel="Test result"
                  editable={!savingEdit}
                  keyboardType="decimal-pad"
                  onChangeText={setEditValue}
                  selectTextOnFocus
                  style={styles.editInput}
                  value={editValue}
                />
              )}
              <Text style={styles.editUnit}>
                {editingTest &&
                editingTest.testKit?.rawReading !== undefined
                  ? (alkalinityKitForEvent(editingTest)?.inputUnit ??
                    calciumKitForEvent(editingTest)?.inputUnit ??
                    magnesiumKitForEvent(editingTest)?.inputUnit ??
                    iodineKitForEvent(editingTest)?.inputUnit ??
                    nitrateKitForEvent(editingTest)?.inputUnit ??
                    phosphateKitForEvent(editingTest)?.inputUnit ??
                    ironKitForEvent(editingTest)?.inputUnit ??
                    potassiumKitForEvent(editingTest)?.inputUnit ??
                    editingTest.unit)
                  : editingTest?.unit}
              </Text>
            </View>

            {editingTest?.testKit?.rawReading !== undefined &&
            Number.isFinite(Number(editValue)) &&
            alkalinityKitForEvent(editingTest) ? (
              <Text style={styles.editCalculated}>
                Calculated alkalinity:{" "}
                {alkalinityKitForEvent(editingTest)!.calculateDkh(
                  Number(editValue),
                ).toFixed(
                  alkalinityKitForEvent(editingTest)!.resultDecimals,
                )}{" "}
                dKH
              </Text>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            phosphateKitForEvent(editingTest) &&
            phosphateReadingIsValid(
              phosphateKitForEvent(editingTest)!,
              Number(editValue),
            ) ? (
              <Text style={styles.editCalculated}>
                Phosphate result:{" "}
                {phosphateResultLabel(
                  phosphateKitForEvent(editingTest)!,
                  phosphateKitForEvent(editingTest)!.calculatePpm(
                    Number(editValue),
                  ),
                )}
              </Text>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            ironKitForEvent(editingTest) &&
            ironReadingIsValid(
              ironKitForEvent(editingTest)!,
              Number(editValue),
            ) ? (
              <Text style={styles.editCalculated}>
                Iron result:{" "}
                {ironResultLabel(
                  ironKitForEvent(editingTest)!,
                  ironKitForEvent(editingTest)!.calculatePpm(Number(editValue)),
                )}
              </Text>
            ) : null}

            {editingTest &&
            magnesiumKitForEvent(editingTest)?.secondaryInput ? (
              <>
                <Text style={styles.editLabel}>
                  {magnesiumKitForEvent(editingTest)!.secondaryInput!.label}
                </Text>
                <View style={styles.editResultRow}>
                  <TextInput
                    accessibilityLabel="Secondary test result"
                    editable={!savingEdit}
                    keyboardType="decimal-pad"
                    onChangeText={setEditSecondaryValue}
                    style={styles.editInput}
                    value={editSecondaryValue}
                  />
                  <Text style={styles.editUnit}>
                    {magnesiumKitForEvent(editingTest)!.secondaryInput!.unit}
                  </Text>
                </View>
              </>
            ) : null}

            {editingTest &&
            potassiumKitForEvent(editingTest)?.secondaryInput ? (
              <>
                <Text style={styles.editLabel}>
                  {potassiumKitForEvent(editingTest)!.secondaryInput!.label}
                </Text>
                <View style={styles.editResultRow}>
                  <TextInput
                    accessibilityLabel="Secondary test result"
                    editable={!savingEdit}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setEditSecondaryValue}
                    style={styles.editInput}
                    value={editSecondaryValue}
                  />
                  <Text style={styles.editUnit}>
                    {potassiumKitForEvent(editingTest)!.secondaryInput!.unit}
                  </Text>
                </View>
              </>
            ) : null}

            {editingTest &&
            calciumKitForEvent(editingTest)?.secondaryInput ? (
              <>
                <Text style={styles.editLabel}>
                  {calciumKitForEvent(editingTest)!.secondaryInput!.label}
                </Text>
                <View style={styles.editResultRow}>
                  <TextInput
                    accessibilityLabel="Secondary test result"
                    editable={!savingEdit}
                    keyboardType="decimal-pad"
                    onChangeText={setEditSecondaryValue}
                    style={styles.editInput}
                    value={editSecondaryValue}
                  />
                  <Text style={styles.editUnit}>
                    {calciumKitForEvent(editingTest)!.secondaryInput!.unit}
                  </Text>
                </View>
              </>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            nitrateKitForEvent(editingTest) &&
            nitrateReadingIsValid(
              nitrateKitForEvent(editingTest)!,
              Number(editValue),
            ) ? (
              <Text style={styles.editCalculated}>
                Nitrate result:{" "}
                {nitrateResultLabel(
                  nitrateKitForEvent(editingTest)!,
                  nitrateKitForEvent(editingTest)!.calculatePpm(
                    Number(editValue),
                  ),
                )}
              </Text>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            magnesiumKitForEvent(editingTest) &&
            magnesiumReadingIsValid(
              magnesiumKitForEvent(editingTest)!,
              Number(editValue),
              magnesiumKitForEvent(editingTest)!.secondaryInput
                ? Number(editSecondaryValue)
                : undefined,
            ) ? (
              <Text style={styles.editCalculated}>
                Calculated magnesium:{" "}
                {magnesiumKitForEvent(editingTest)!.calculatePpm(
                  Number(editValue),
                  magnesiumKitForEvent(editingTest)!.secondaryInput
                    ? Number(editSecondaryValue)
                    : undefined,
                ).toFixed(
                  magnesiumKitForEvent(editingTest)!.resultDecimals,
                )}{" "}
                ppm
              </Text>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            iodineKitForEvent(editingTest) &&
            iodineReadingIsValid(
              iodineKitForEvent(editingTest)!,
              Number(editValue),
            ) ? (
              <Text style={styles.editCalculated}>
                Iodine result:{" "}
                {iodineResultLabel(
                  iodineKitForEvent(editingTest)!,
                  iodineKitForEvent(editingTest)!.calculatePpm(
                    Number(editValue),
                  ),
                )}
              </Text>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            potassiumKitForEvent(editingTest) &&
            potassiumReadingIsValid(
              potassiumKitForEvent(editingTest)!,
              Number(editValue),
              potassiumKitForEvent(editingTest)!.secondaryInput
                ? Number(editSecondaryValue)
                : undefined,
            ) ? (
              <Text style={styles.editCalculated}>
                Calculated potassium:{" "}
                {potassiumResultLabel(
                  potassiumKitForEvent(editingTest)!,
                  Number(editValue),
                  potassiumKitForEvent(editingTest)!.calculatePpm(
                    Number(editValue),
                    potassiumKitForEvent(editingTest)!.secondaryInput
                      ? Number(editSecondaryValue)
                      : undefined,
                  ),
                )}
              </Text>
            ) : null}

            {editingTest?.testKit?.rawReading !== undefined &&
            Number.isFinite(Number(editValue)) &&
            calciumKitForEvent(editingTest) &&
            calciumReadingIsValid(
              calciumKitForEvent(editingTest)!,
              Number(editValue),
              calciumKitForEvent(editingTest)!.secondaryInput
                ? Number(editSecondaryValue)
                : undefined,
            ) ? (
              <Text style={styles.editCalculated}>
                Calculated calcium:{" "}
                {calciumKitForEvent(editingTest)!.calculatePpm(
                  Number(editValue),
                  calciumKitForEvent(editingTest)!.secondaryInput
                    ? Number(editSecondaryValue)
                    : undefined,
                ).toFixed(
                  calciumKitForEvent(editingTest)!.resultDecimals,
                )}{" "}
                ppm
              </Text>
            ) : null}

            <Text style={styles.editLabel}>Test date and time</Text>
            <View style={styles.editDateTimeRow}>
              <TextInput
                accessibilityLabel="Test date"
                autoCapitalize="none"
                editable={!savingEdit}
                keyboardType="numbers-and-punctuation"
                onChangeText={setEditDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#607A98"
                style={[styles.editInput, styles.editDateInput]}
                value={editDate}
              />
              <TextInput
                accessibilityLabel="Test time"
                autoCapitalize="none"
                editable={!savingEdit}
                keyboardType="numbers-and-punctuation"
                onChangeText={setEditTime}
                placeholder="HH:MM"
                placeholderTextColor="#607A98"
                style={[styles.editInput, styles.editTimeInput]}
                value={editTime}
              />
            </View>

            <Text style={styles.editLabel}>Comment (optional)</Text>
            <TextInput
              accessibilityLabel="Test comment"
              editable={!savingEdit}
              multiline
              onChangeText={setEditNotes}
              placeholder="Kit, conditions, or anything unusual"
              placeholderTextColor="#607A98"
              style={[styles.editInput, styles.editNotes]}
              value={editNotes}
            />

            {editError ? (
              <Text style={styles.editError}>{editError}</Text>
            ) : null}

          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    width: "100%",
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  eyebrow: {
    color: "#20B7EC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "700",
    marginTop: 4,
  },
  refreshButton: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  refreshText: {
    color: "#20B7EC",
    fontSize: 22,
  },
  parameterChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  historyToggle: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#0A2949",
    borderColor: "#214869",
    borderRadius: 15,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    marginLeft: "auto",
    width: 48,
  },
  historyToggleActive: {
    backgroundColor: "#123C64",
    borderColor: "#20B7EC",
  },
  parameterChoice: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#214869",
    borderRadius: 15,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 48,
  },
  parameterChoiceActive: {
    backgroundColor: "#123C64",
  },
  parameterText: {
    color: "#C8D7E8",
    fontSize: 13,
    fontWeight: "700",
  },
  parameterTextActive: {
    color: "#FFFFFF",
  },
  chartCard: {
    backgroundColor: "#08213D",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
    padding: 17,
  },
  chartHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  chartTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  chartRange: {
    color: "#8FA4BF",
    fontSize: 12,
  },
  presetChoices: {
    flexDirection: "row",
    gap: 6,
    marginTop: 14,
  },
  presetChoice: {
    borderColor: "#214869",
    borderRadius: 11,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 6,
  },
  presetText: {
    color: "#9FB1C7",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  presetTextActive: {
    color: "#061B31",
  },
  chart: {
    position: "relative",
    borderBottomColor: "#214869",
    borderBottomWidth: 1,
    height: 132,
    marginTop: 15,
  },
  chartEmpty: {
    color: "#7890AC",
    fontSize: 12,
    paddingLeft: 48,
    paddingTop: 48,
    textAlign: "center",
  },
  yAxis: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: 62,
  },
  yAxisLabel: {
    color: "#7890AC",
    fontSize: 9,
    fontVariant: ["tabular-nums"],
    position: "absolute",
    right: 5,
    textAlign: "right",
  },
  chartGridLine: {
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    opacity: 0.7,
    position: "absolute",
    right: 0,
  },
  statistics: {
    flexDirection: "row",
    gap: 6,
    marginTop: 14,
  },
  statistic: {
    backgroundColor: "#061B31",
    borderRadius: 9,
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  statisticLabel: {
    color: "#7890AC",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  statisticValue: {
    color: "#E9F2F5",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  navigatorLabel: {
    color: "#7890AC",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 14,
  },
  navigator: {
    height: 38,
    justifyContent: "center",
    position: "relative",
  },
  navigatorTrack: {
    backgroundColor: "#153E63",
    borderRadius: 3,
    height: 6,
    left: 10,
    position: "absolute",
    right: 10,
  },
  navigatorSelection: {
    borderRadius: 3,
    height: 8,
    opacity: 0.45,
    position: "absolute",
  },
  navigatorHandle: {
    backgroundColor: "#08213D",
    borderRadius: 8,
    borderWidth: 3,
    height: 16,
    position: "absolute",
    width: 16,
  },
  chartLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  legendSwatch: {
    borderRadius: 3,
    height: 3,
    width: 14,
  },
  legendText: {
    fontSize: 11,
    fontWeight: "700",
  },
  chartLine: {
    height: 3,
    position: "absolute",
    transformOrigin: "left center",
  },
  chartPoint: {
    borderColor: "#08213D",
    borderRadius: 4,
    borderWidth: 1,
    height: 8,
    position: "absolute",
    width: 8,
  },
  historyCard: {
    backgroundColor: "#08213D",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  historyHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 17,
  },
  historyTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  historyCount: {
    color: "#7890AC",
    fontSize: 11,
    marginTop: 3,
  },
  limitChoices: {
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 14,
  },
  limitChoice: {
    borderColor: "#214869",
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  limitChoiceActive: {
    backgroundColor: "#123C64",
    borderColor: "#20B7EC",
  },
  limitText: {
    color: "#9FB1C7",
    fontSize: 12,
    fontWeight: "700",
  },
  limitTextActive: {
    color: "#FFFFFF",
  },
  loadMoreButton: {
    alignItems: "center",
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    paddingHorizontal: 17,
    paddingVertical: 14,
  },
  loadMoreText: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "800",
  },
  eventRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 66,
    paddingHorizontal: 17,
    paddingVertical: 10,
  },
  eventRowBorder: {
    borderTopColor: "#102F50",
    borderTopWidth: 1,
  },
  eventValue: {
    color: "#E9F2F5",
    fontSize: 15,
    fontWeight: "700",
  },
  eventKit: {
    color: "#7890AC",
    fontSize: 11,
    marginTop: 3,
  },
  eventRight: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  eventDate: {
    color: "#7890AC",
    fontSize: 11,
    textAlign: "right",
  },
  rowDisclosure: {
    color: "#20B7EC",
    fontSize: 22,
  },
  message: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 28,
  },
  muted: {
    color: "#8FA4BF",
    fontSize: 13,
  },
  error: {
    color: "#FCA5A5",
    fontSize: 13,
    textAlign: "center",
  },
  retry: {
    color: "#20B7EC",
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    color: "#8FA4BF",
    fontSize: 13,
    paddingVertical: 22,
    textAlign: "center",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(2, 12, 24, 0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  editCard: {
    backgroundColor: "#08213D",
    borderColor: "#20B7EC",
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: "92%",
    maxWidth: 520,
    width: "100%",
  },
  editCardContent: {
    padding: 20,
  },
  editHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  editHeaderCopy: {
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  editHeaderActions: {
    flexDirection: "row",
    gap: 8,
  },
  editEyebrow: {
    color: "#20B7EC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  editTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    marginTop: 4,
  },
  editLabel: {
    color: "#9FB1C7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 16,
  },
  editResultRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  editReadingChoices: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  editReadingChoice: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 2,
    flexGrow: 1,
    minWidth: 54,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  editReadingChoiceActive: {
    borderColor: "#FFFFFF",
  },
  editReadingChoiceText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  editDateTimeRow: {
    flexDirection: "row",
    gap: 10,
  },
  editDateInput: {
    flex: 1.5,
  },
  editTimeInput: {
    flex: 1,
  },
  editInput: {
    backgroundColor: "#061B31",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    color: "#FFFFFF",
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  editUnit: {
    color: "#8FA4BF",
    fontSize: 14,
    minWidth: 36,
  },
  editCalculated: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 10,
  },
  editNotes: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  editError: {
    color: "#FCA5A5",
    fontSize: 12,
    marginTop: 12,
  },
});
