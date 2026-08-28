import { useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import type {
  AquariumEvent,
  WaterParameter,
} from "@modreef/digital-twin";

import {
  CircularActionButton,
} from "./CircularActionButton";
import { DropdownChevron } from "./MeasurementIcons";
import {
  filterJournalEvents,
  journalFilters,
  type JournalFilter,
} from "./journalFiltering";

import {
  alkalinityKit,
  alkalinityKitForEvent,
  alkalinityKitsForBrand,
  alkalinityManufacturers,
  type AlkalinityKitId,
  readingIsValid,
} from "./alkalinityTestKits";
import {
  calciumKit,
  calciumKitForEvent,
  calciumKitsForBrand,
  calciumManufacturers,
  calciumReadingIsValid,
  type CalciumKitId,
} from "./calciumTestKits";
import {
  magnesiumKit,
  magnesiumKitForEvent,
  magnesiumKitsForBrand,
  magnesiumManufacturers,
  magnesiumReadingIsValid,
  type MagnesiumKitId,
} from "./magnesiumTestKits";
import {
  iodineKit,
  iodineKitForEvent,
  iodineKitsForBrand,
  iodineManufacturers,
  iodineReadingIsValid,
  iodineResultLabel,
  type IodineKitId,
} from "./iodineTestKits";
import {
  ironKit,
  ironKitForEvent,
  ironKitsForBrand,
  ironManufacturers,
  ironReadingIsValid,
  ironResultLabel,
  type IronKitId,
} from "./ironTestKits";
import {
  nitrateKit,
  nitrateKitForEvent,
  nitrateKitsForBrand,
  nitrateManufacturers,
  nitrateReadingIsValid,
  nitrateResultLabel,
  type NitrateKitId,
} from "./nitrateTestKits";
import {
  phosphateKit,
  phosphateKitForEvent,
  phosphateKitsForBrand,
  phosphateManufacturers,
  phosphateReadingIsValid,
  phosphateResultLabel,
  type PhosphateKitId,
} from "./phosphateTestKits";
import {
  potassiumKit,
  potassiumKitForEvent,
  potassiumKitsForBrand,
  potassiumManufacturers,
  potassiumReadingIsValid,
  potassiumResultLabel,
  type PotassiumKitId,
} from "./potassiumTestKits";
import {
  type CreateAquariumEventInput,
} from "./edgeClient";
import {
  createDashboardEvent,
  deleteDashboardEvent,
  getDashboardEvents,
  updateDashboardEvent,
} from "./dashboardConnection";

type TestKitPreference =
  | AlkalinityKitId
  | CalciumKitId
  | MagnesiumKitId
  | IodineKitId
  | IronKitId
  | NitrateKitId
  | PhosphateKitId
  | PotassiumKitId;

type TestKitPreferences = Partial<
  Record<WaterParameter, TestKitPreference>
>;

const testKitPreferencesKey = "modreef.journal.test-kit-preferences";
const journalLimits = [20, 50, 100] as const;

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): BrowserStorage | null {
  const storage = (globalThis as { localStorage?: BrowserStorage })
    .localStorage;
  return storage ?? null;
}

async function loadTestKitPreferences(): Promise<TestKitPreferences> {
  if (await SecureStore.isAvailableAsync()) {
    const stored = await SecureStore.getItemAsync(testKitPreferencesKey);
    return stored ? (JSON.parse(stored) as TestKitPreferences) : {};
  }

  const stored = browserStorage()?.getItem(testKitPreferencesKey);
  return stored ? (JSON.parse(stored) as TestKitPreferences) : {};
}

async function saveTestKitPreferences(
  preferences: TestKitPreferences,
): Promise<void> {
  const serialized = JSON.stringify(preferences);

  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.setItemAsync(testKitPreferencesKey, serialized);
    return;
  }

  browserStorage()?.setItem(testKitPreferencesKey, serialized);
}

const testParameters: Array<{
  label: string;
  parameter: WaterParameter;
  unit: string;
  name?: string;
}> = [
  { label: "Alkalinity", parameter: "alkalinity", unit: "dKH" },
  { label: "Calcium", parameter: "calcium", unit: "ppm" },
  { label: "Magnesium", parameter: "magnesium", unit: "ppm" },
  { label: "Potassium", parameter: "potassium", unit: "ppm" },
  { label: "Nitrate", parameter: "nitrate", unit: "ppm" },
  { label: "Phosphate", parameter: "phosphate", unit: "ppm" },
  { label: "Iodine", parameter: "iodine", unit: "ppm" },
  { label: "Iron", parameter: "iron", unit: "ppm" },
  { label: "Other", parameter: "other", unit: "ppm" },
];

function eventTitle(event: AquariumEvent): string {
  switch (event.type) {
    case "measurement":
      return `${event.name ?? event.parameter}: ${event.value} ${event.unit}`;
    case "dose":
      return `${event.product}: ${event.amount} ${event.unit}`;
    case "feeding":
      return event.food;
    case "maintenance":
      return event.activity;
    case "observation":
      return event.observation;
    case "activity":
      return event.title;
  }
}

function eventLabel(event: AquariumEvent): string {
  switch (event.type) {
    case "measurement":
      return "TEST";
    case "dose":
      return "DOSE";
    case "feeding":
      return "FEED";
    case "maintenance":
      return "MAINTENANCE";
    case "observation":
      return "NOTE";
    case "activity":
      return event.category === "feed-cycle"
        ? "FEED CYCLE"
        : event.category.toUpperCase();
  }
}

function eventTime(event: AquariumEvent): string {
  const date = new Date(event.occurredAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function localDateParts(isoDate: string): { date: string; time: string } {
  const value = new Date(isoDate);
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}

function localDateTime(date: string, time: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;

  const value = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );

  return value.getFullYear() === Number(dateMatch[1]) &&
    value.getMonth() === Number(dateMatch[2]) - 1 &&
    value.getDate() === Number(dateMatch[3]) &&
    value.getHours() === Number(timeMatch[1]) &&
    value.getMinutes() === Number(timeMatch[2])
    ? value
    : null;
}

export interface TestEntryRequest {
  parameter: WaterParameter;
  name?: string;
  nonce: number;
}

export interface NoteEntryRequest {
  nonce: number;
}

export function AquariumLogPanel({
  defaultExpanded = false,
  modalOnly = false,
  onTestEntryClosed,
  onTestSaved,
  noteEntryRequest,
  onNoteEntryClosed,
  onNoteSaved,
  testEntryRequest,
}: {
  defaultExpanded?: boolean;
  modalOnly?: boolean;
  onTestEntryClosed?: () => void;
  onTestSaved?: (event: AquariumEvent) => void;
  noteEntryRequest?: NoteEntryRequest | null;
  onNoteEntryClosed?: () => void;
  onNoteSaved?: (event: AquariumEvent) => void;
  testEntryRequest?: TestEntryRequest | null;
}) {
  const { height: windowHeight, width: windowWidth } =
    useWindowDimensions();
  const compactLandscapeMenu = windowWidth > windowHeight;
  const [events, setEvents] = useState<AquariumEvent[]>([]);
  const [journalLimit, setJournalLimit] =
    useState<(typeof journalLimits)[number]>(20);
  const [visibleJournalCount, setVisibleJournalCount] = useState(20);
  const [journalQuery, setJournalQuery] = useState("");
  const [journalFilter, setJournalFilter] = useState<JournalFilter>("all");
  const [journalFilterMenuOpen, setJournalFilterMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [panelExpanded, setPanelExpanded] = useState(defaultExpanded);
  const [entryMenuOpen, setEntryMenuOpen] = useState(false);
  const [testFormOpen, setTestFormOpen] = useState(false);
  const [testParameter, setTestParameter] =
    useState<WaterParameter>("alkalinity");
  const [testName, setTestName] = useState("");
  const [testValue, setTestValue] = useState("");
  const [testSecondaryValue, setTestSecondaryValue] = useState("");
  const [testNotes, setTestNotes] = useState("");
  const [manufacturerMenuOpen, setManufacturerMenuOpen] =
    useState(false);
  const [optionMenuOpen, setOptionMenuOpen] = useState(false);
  const [parameterMenuOpen, setParameterMenuOpen] = useState(false);
  const [testKitPreferences, setTestKitPreferences] =
    useState<TestKitPreferences>({});
  const [savingTest, setSavingTest] = useState(false);
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteObservation, setNoteObservation] = useState("");
  const [noteCategory, setNoteCategory] = useState("");
  const [noteDetails, setNoteDetails] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] =
    useState<AquariumEvent | null>(null);
  const [editPrimary, setEditPrimary] = useState("");
  const [editSecondary, setEditSecondary] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] =
    useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    void (async () => {
      try {
        setTestKitPreferences(await loadTestKitPreferences());
      } catch {
        // Test-kit preferences are helpful, but never block logging.
      }
    })();
  }, []);

  useEffect(() => {
    if (!testEntryRequest) {
      return;
    }

    setTestParameter(testEntryRequest.parameter);
    setTestName(testEntryRequest.name ?? "");
    setEntryMenuOpen(true);
    setTestFormOpen(true);
    setTestValue("");
    setTestSecondaryValue("");
    setTestNotes("");
    setManufacturerMenuOpen(false);
    setOptionMenuOpen(false);
    setParameterMenuOpen(false);
    setFormError(null);
  }, [testEntryRequest]);

  useEffect(() => {
    if (!noteEntryRequest) return;
    setNoteObservation("");
    setNoteCategory("");
    setNoteDetails("");
    setNoteError(null);
    setNoteFormOpen(true);
  }, [noteEntryRequest]);

  function closeNoteForm(): void {
    if (savingNote) return;
    setNoteFormOpen(false);
    setNoteError(null);
    onNoteEntryClosed?.();
  }

  async function saveNote(): Promise<void> {
    const observation = noteObservation.trim();
    if (!observation) {
      setNoteError("Enter a note.");
      return;
    }
    try {
      setSavingNote(true);
      setNoteError(null);
      const event = await createDashboardEvent({
        type: "observation",
        observation,
        source: "manual",
        occurredAt: new Date().toISOString(),
        ...(noteCategory.trim() ? { category: noteCategory.trim() } : {}),
        ...(noteDetails.trim() ? { notes: noteDetails.trim() } : {}),
      });
      setEvents((current) => [event, ...current].slice(0, 1000));
      setNoteFormOpen(false);
      onNoteSaved?.(event);
      onNoteEntryClosed?.();
    } catch (requestError) {
      setNoteError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSavingNote(false);
    }
  }

  const testParameterOptions = useMemo(() => {
    const custom = new Map<string, (typeof testParameters)[number]>();

    for (const event of events) {
      if (event.type !== "measurement" || event.parameter !== "other") {
        continue;
      }

      const name = event.name?.trim();
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      if (!custom.has(key)) {
        custom.set(key, {
          label: name,
          parameter: "other",
          unit: event.unit || "ppm",
          name,
        });
      }
    }

    return [...testParameters, ...custom.values()];
  }, [events]);

  const filteredEvents = useMemo(
    () => filterJournalEvents(events, journalFilter, journalQuery),
    [events, journalFilter, journalQuery],
  );

  useEffect(() => {
    setVisibleJournalCount(journalLimit);
  }, [journalFilter, journalLimit, journalQuery]);

  const selectedParameterOption =
    testParameterOptions.find(
      (item) =>
        item.parameter === testParameter &&
        (testParameter !== "other" ||
          (item.name ?? "").toLocaleLowerCase() ===
            testName.trim().toLocaleLowerCase()),
    ) ?? testParameters.find((item) => item.parameter === testParameter);

  async function selectTestKit(
    preference: TestKitPreference,
  ): Promise<void> {
    const updated = {
      ...testKitPreferences,
      [testParameter]: preference,
    };

    setTestKitPreferences(updated);
    setTestValue("");
    setTestSecondaryValue("");
    setFormError(null);
    setManufacturerMenuOpen(false);
    setOptionMenuOpen(false);

    try {
      await saveTestKitPreferences(updated);
    } catch {
      // Keep the in-memory selection when secure storage is unavailable.
    }
  }

  const selectedTestKit =
    testKitPreferences[testParameter] ??
    (testParameter === "calcium"
      ? "calcium-direct"
      : testParameter === "magnesium"
        ? "magnesium-direct"
        : testParameter === "potassium"
          ? "potassium-direct"
          : testParameter === "iodine"
            ? "iodine-direct"
            : testParameter === "nitrate"
              ? "nitrate-direct"
              : testParameter === "phosphate"
                ? "phosphate-direct"
                : testParameter === "iron"
                  ? "iron-direct"
            : "direct");
  const selectedAlkalinityKit = alkalinityKit(selectedTestKit);
  const selectedCalciumKit = calciumKit(selectedTestKit);
  const selectedMagnesiumKit = magnesiumKit(selectedTestKit);
  const selectedIodineKit = iodineKit(selectedTestKit);
  const selectedNitrateKit = nitrateKit(selectedTestKit);
  const selectedPhosphateKit = phosphateKit(selectedTestKit);
  const selectedIronKit = ironKit(selectedTestKit);
  const selectedPotassiumKit = potassiumKit(selectedTestKit);
  const selectedBrandKits = alkalinityKitsForBrand(
    selectedAlkalinityKit.brand,
  );
  const selectedCalciumBrandKits = calciumKitsForBrand(
    selectedCalciumKit.brand,
  );
  const selectedMagnesiumBrandKits = magnesiumKitsForBrand(
    selectedMagnesiumKit.brand,
  );
  const selectedIodineBrandKits = iodineKitsForBrand(
    selectedIodineKit.brand,
  );
  const selectedNitrateBrandKits = nitrateKitsForBrand(
    selectedNitrateKit.brand,
  );
  const selectedPhosphateBrandKits = phosphateKitsForBrand(
    selectedPhosphateKit.brand,
  );
  const selectedIronBrandKits = ironKitsForBrand(selectedIronKit.brand);
  const rawReading = Number(testValue);
  const secondaryRawReading = Number(testSecondaryValue);
  const calculatedDkh =
    testParameter === "alkalinity" &&
    readingIsValid(selectedAlkalinityKit, rawReading)
      ? selectedAlkalinityKit.calculateDkh(rawReading)
      : null;
  const calculatedCalciumPpm =
    testParameter === "calcium" &&
    calciumReadingIsValid(
      selectedCalciumKit,
      rawReading,
      selectedCalciumKit.secondaryInput
        ? secondaryRawReading
        : undefined,
    )
      ? selectedCalciumKit.calculatePpm(
          rawReading,
          selectedCalciumKit.secondaryInput
            ? secondaryRawReading
            : undefined,
        )
      : null;
  const calculatedMagnesiumPpm =
    testParameter === "magnesium" &&
    magnesiumReadingIsValid(
      selectedMagnesiumKit,
      rawReading,
      selectedMagnesiumKit.secondaryInput
        ? secondaryRawReading
        : undefined,
    )
      ? selectedMagnesiumKit.calculatePpm(
          rawReading,
          selectedMagnesiumKit.secondaryInput
            ? secondaryRawReading
            : undefined,
        )
      : null;
  const calculatedPotassiumPpm =
    testParameter === "potassium" &&
    potassiumReadingIsValid(
      selectedPotassiumKit,
      rawReading,
      selectedPotassiumKit.secondaryInput
        ? secondaryRawReading
        : undefined,
    )
      ? selectedPotassiumKit.calculatePpm(
          rawReading,
          selectedPotassiumKit.secondaryInput
            ? secondaryRawReading
            : undefined,
        )
      : null;
  const calculatedIodinePpm =
    testParameter === "iodine" &&
    iodineReadingIsValid(selectedIodineKit, rawReading)
      ? selectedIodineKit.calculatePpm(rawReading)
      : null;
  const calculatedNitratePpm =
    testParameter === "nitrate" &&
    nitrateReadingIsValid(selectedNitrateKit, rawReading)
      ? selectedNitrateKit.calculatePpm(rawReading)
      : null;
  const calculatedPhosphatePpm =
    testParameter === "phosphate" &&
    phosphateReadingIsValid(selectedPhosphateKit, rawReading)
      ? selectedPhosphateKit.calculatePpm(rawReading)
      : null;
  const calculatedIronPpm =
    testParameter === "iron" &&
    ironReadingIsValid(selectedIronKit, rawReading)
      ? selectedIronKit.calculatePpm(rawReading)
      : null;

  function selectManufacturer(brand: string): void {
    const firstKit = alkalinityKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectCalciumManufacturer(brand: string): void {
    const firstKit = calciumKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectMagnesiumManufacturer(brand: string): void {
    const firstKit = magnesiumKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectIodineManufacturer(brand: string): void {
    const firstKit = iodineKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectNitrateManufacturer(brand: string): void {
    const firstKit = nitrateKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectPhosphateManufacturer(brand: string): void {
    const firstKit = phosphateKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectIronManufacturer(brand: string): void {
    const firstKit = ironKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  function selectPotassiumManufacturer(brand: string): void {
    const firstKit = potassiumKitsForBrand(brand)[0];
    if (firstKit) void selectTestKit(firstKit.id);
  }

  async function removeEvent(eventId: string) {
    try {
      setDeletingEventId(eventId);
      setError(null);
      await deleteDashboardEvent(eventId);
      setEvents((current) =>
        current.filter((event) => event.id !== eventId),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setDeletingEventId(null);
    }
  }

  function confirmDelete(event: AquariumEvent) {
    Alert.alert(
      "Delete journal entry?",
      eventTitle(event),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void removeEvent(event.id),
        },
      ],
    );
  }

  function beginEdit(event: AquariumEvent): void {
    if (event.type === "activity") {
      return;
    }

    const occurredAt = localDateParts(event.occurredAt);
    setEditingEvent(event);
    setEditNotes(event.notes ?? "");
    setEditDate(occurredAt.date);
    setEditTime(occurredAt.time);
    setEditSecondary("");
    setEditAmount("");
    setEditUnit("");
    setEditError(null);

    switch (event.type) {
      case "measurement":
        setEditPrimary(
          String(event.testKit?.rawReading ?? event.value),
        );
        setEditSecondary(
          event.testKit?.secondaryRawReading === undefined
            ? ""
            : String(event.testKit.secondaryRawReading),
        );
        setEditUnit(event.unit);
        break;
      case "dose":
        setEditPrimary(event.product);
        setEditAmount(String(event.amount));
        setEditUnit(event.unit);
        break;
      case "feeding":
        setEditPrimary(event.food);
        setEditAmount(event.amount === undefined ? "" : String(event.amount));
        setEditUnit(event.unit ?? "");
        break;
      case "maintenance":
        setEditPrimary(event.activity);
        setEditSecondary(event.details ?? "");
        break;
      case "observation":
        setEditPrimary(event.observation);
        setEditSecondary(event.category ?? "");
        break;
    }
  }

  function closeEdit(): void {
    if (!savingEdit) {
      setEditingEvent(null);
      setEditError(null);
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editingEvent || editingEvent.type === "activity") return;

    const occurredAt = localDateTime(editDate, editTime);
    if (!occurredAt) {
      setEditError("Enter a valid date and time.");
      return;
    }

    const primary = editPrimary.trim();
    if (!primary) {
      setEditError(
        editingEvent.type === "measurement"
          ? "Enter a valid result."
          : "The main entry field is required.",
      );
      return;
    }

    let input: CreateAquariumEventInput;
    const common = {
      source: editingEvent.source,
      occurredAt: occurredAt.toISOString(),
      ...(editNotes.trim() ? { notes: editNotes.trim() } : {}),
    };

    switch (editingEvent.type) {
      case "measurement": {
        const enteredValue = Number(primary);
        const alkalinityEventKit = alkalinityKitForEvent(editingEvent);
        const calciumEventKit = calciumKitForEvent(editingEvent);
        const magnesiumEventKit = magnesiumKitForEvent(editingEvent);
        const iodineEventKit = iodineKitForEvent(editingEvent);
        const nitrateEventKit = nitrateKitForEvent(editingEvent);
        const phosphateEventKit = phosphateKitForEvent(editingEvent);
        const ironEventKit = ironKitForEvent(editingEvent);
        const potassiumEventKit = potassiumKitForEvent(editingEvent);
        const usesAlkalinityReading =
          alkalinityEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesCalciumReading =
          calciumEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesMagnesiumReading =
          magnesiumEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesIodineReading =
          iodineEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesNitrateReading =
          nitrateEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesPhosphateReading =
          phosphateEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesIronReading =
          ironEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const usesPotassiumReading =
          potassiumEventKit !== null &&
          editingEvent.testKit?.rawReading !== undefined;
        const secondaryInput =
          calciumEventKit?.secondaryInput ??
          magnesiumEventKit?.secondaryInput ??
          potassiumEventKit?.secondaryInput;
        const enteredSecondaryValue = secondaryInput
          ? Number(editSecondary)
          : undefined;

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
              : "Enter a valid result.",
          );
          return;
        }

        input = {
          ...common,
          type: "measurement",
          parameter: editingEvent.parameter,
          ...(editingEvent.name ? { name: editingEvent.name } : {}),
          value: usesAlkalinityReading
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
                : usesIodineReading
                  ? iodineEventKit.calculatePpm(enteredValue)
                : usesNitrateReading
                  ? nitrateEventKit.calculatePpm(enteredValue)
                : usesPhosphateReading
                  ? phosphateEventKit.calculatePpm(enteredValue)
                : usesIronReading
                  ? ironEventKit.calculatePpm(enteredValue)
                : usesPotassiumReading
                  ? potassiumEventKit.calculatePpm(
                      enteredValue,
                      enteredSecondaryValue,
                    )
              : enteredValue,
          unit: editingEvent.unit,
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
                  ...editingEvent.testKit!,
                  rawReading: enteredValue,
                  ...(enteredSecondaryValue === undefined
                    ? {}
                    : { secondaryRawReading: enteredSecondaryValue }),
                },
              }
            : editingEvent.testKit
              ? { testKit: editingEvent.testKit }
              : {}),
        };
        break;
      }
      case "dose": {
        const amount = Number(editAmount);
        if (!Number.isFinite(amount) || !editUnit.trim()) {
          setEditError("Enter a valid amount and unit.");
          return;
        }
        input = {
          ...common,
          type: "dose",
          product: primary,
          category: editingEvent.category,
          amount,
          unit: editUnit.trim(),
          method: editingEvent.method,
          ...(editingEvent.equipmentId
            ? { equipmentId: editingEvent.equipmentId }
            : {}),
        };
        break;
      }
      case "feeding": {
        const amount = editAmount.trim() ? Number(editAmount) : undefined;
        if (amount !== undefined && !Number.isFinite(amount)) {
          setEditError("Enter a valid feeding amount.");
          return;
        }
        input = {
          ...common,
          type: "feeding",
          food: primary,
          method: editingEvent.method,
          ...(amount === undefined ? {} : { amount }),
          ...(editUnit.trim() ? { unit: editUnit.trim() } : {}),
          ...(editingEvent.equipmentId
            ? { equipmentId: editingEvent.equipmentId }
            : {}),
        };
        break;
      }
      case "maintenance":
        input = {
          ...common,
          type: "maintenance",
          activity: primary,
          ...(editSecondary.trim()
            ? { details: editSecondary.trim() }
            : {}),
        };
        break;
      case "observation":
        input = {
          ...common,
          type: "observation",
          observation: primary,
          ...(editSecondary.trim()
            ? { category: editSecondary.trim() }
            : {}),
        };
        break;
    }

    try {
      setSavingEdit(true);
      setEditError(null);
      const updated = await updateDashboardEvent(editingEvent.id, input);
      setEvents((current) =>
        current.map((event) =>
          event.id === updated.id ? updated : event,
        ),
      );
      setEditingEvent(null);
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

  async function saveTest() {
    const enteredValue = Number(testValue);
    const selection = selectedParameterOption;
    const customName = testName.trim();
    const usesAlkalinityKit =
      testParameter === "alkalinity" && selectedTestKit !== "direct";
    const usesCalciumKit =
      testParameter === "calcium" &&
      selectedTestKit !== "calcium-direct";
    const usesMagnesiumKit =
      testParameter === "magnesium" &&
      selectedTestKit !== "magnesium-direct";
    const usesIodineKit =
      testParameter === "iodine" &&
      selectedTestKit !== "iodine-direct";
    const usesNitrateKit =
      testParameter === "nitrate" &&
      selectedTestKit !== "nitrate-direct";
    const usesPhosphateKit =
      testParameter === "phosphate" &&
      selectedTestKit !== "phosphate-direct";
    const usesIronKit =
      testParameter === "iron" && selectedTestKit !== "iron-direct";
    const usesPotassiumKit =
      testParameter === "potassium" &&
      selectedTestKit !== "potassium-direct";
    const value =
      testParameter === "alkalinity"
        ? calculatedDkh
        : testParameter === "calcium"
          ? calculatedCalciumPpm
          : testParameter === "magnesium"
            ? calculatedMagnesiumPpm
            : testParameter === "potassium"
              ? calculatedPotassiumPpm
              : testParameter === "iodine"
                ? calculatedIodinePpm
                : testParameter === "nitrate"
                  ? calculatedNitratePpm
                : testParameter === "phosphate"
                  ? calculatedPhosphatePpm
                  : testParameter === "iron"
                    ? calculatedIronPpm
          : enteredValue;

    if (
      !selection ||
      value === null ||
      !Number.isFinite(value) ||
      (testParameter === "other" && !customName)
    ) {
      setFormError(
        testParameter === "other" && !customName
          ? "Enter a test name."
          : testParameter === "alkalinity"
          ? `Enter a ${selectedAlkalinityKit.inputLabel.toLowerCase()} from ${selectedAlkalinityKit.minimum.toFixed(selectedAlkalinityKit.decimals)} to ${selectedAlkalinityKit.maximum.toFixed(selectedAlkalinityKit.decimals)}.`
          : testParameter === "calcium"
            ? `Enter valid ${selectedCalciumKit.inputLabel.toLowerCase()}${selectedCalciumKit.secondaryInput ? ` and ${selectedCalciumKit.secondaryInput.label.toLowerCase()}` : ""}.`
            : testParameter === "magnesium"
              ? `Enter valid ${selectedMagnesiumKit.inputLabel.toLowerCase()}${selectedMagnesiumKit.secondaryInput ? ` and ${selectedMagnesiumKit.secondaryInput.label.toLowerCase()}` : ""}.`
              : testParameter === "potassium"
                ? `Enter valid ${selectedPotassiumKit.inputLabel.toLowerCase()}${selectedPotassiumKit.secondaryInput ? ` and ${selectedPotassiumKit.secondaryInput.label.toLowerCase()}` : ""}.`
                : testParameter === "iodine"
                  ? "Select or enter a valid iodine kit reading."
                  : testParameter === "nitrate"
                    ? "Select or enter a valid nitrate kit reading."
                  : testParameter === "phosphate"
                    ? "Select or enter a valid phosphate kit reading."
                    : testParameter === "iron"
                      ? "Select or enter a valid iron kit reading."
          : "Enter a valid test result.",
      );
      return;
    }

    try {
      setSavingTest(true);
      setFormError(null);

      const event = await createDashboardEvent({
        type: "measurement",
        parameter: testParameter,
        ...(testParameter === "other" ? { name: customName } : {}),
        value,
        unit: selection.unit,
        source: "manual",
        ...(usesAlkalinityKit
          ? {
              testKit: {
                brand: selectedAlkalinityKit.brand,
                ...(selectedAlkalinityKit.product
                  ? { product: selectedAlkalinityKit.product }
                  : {}),
                rawReading,
                ...(selectedAlkalinityKit.resolution
                  ? { resolution: selectedAlkalinityKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesCalciumKit
          ? {
              testKit: {
                brand: selectedCalciumKit.brand,
                ...(selectedCalciumKit.product
                  ? { product: selectedCalciumKit.product }
                  : {}),
                rawReading,
                ...(selectedCalciumKit.secondaryInput
                  ? { secondaryRawReading }
                  : {}),
                ...(selectedCalciumKit.resolution
                  ? { resolution: selectedCalciumKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesMagnesiumKit
          ? {
              testKit: {
                brand: selectedMagnesiumKit.brand,
                ...(selectedMagnesiumKit.product
                  ? { product: selectedMagnesiumKit.product }
                  : {}),
                rawReading,
                ...(selectedMagnesiumKit.secondaryInput
                  ? { secondaryRawReading }
                  : {}),
                ...(selectedMagnesiumKit.resolution
                  ? { resolution: selectedMagnesiumKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesPotassiumKit
          ? {
              testKit: {
                brand: selectedPotassiumKit.brand,
                ...(selectedPotassiumKit.product
                  ? { product: selectedPotassiumKit.product }
                  : {}),
                rawReading,
                ...(selectedPotassiumKit.secondaryInput
                  ? { secondaryRawReading }
                  : {}),
                ...(selectedPotassiumKit.resolution
                  ? { resolution: selectedPotassiumKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesIodineKit
          ? {
              testKit: {
                brand: selectedIodineKit.brand,
                ...(selectedIodineKit.product
                  ? { product: selectedIodineKit.product }
                  : {}),
                rawReading,
                ...(selectedIodineKit.resolution
                  ? { resolution: selectedIodineKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesNitrateKit
          ? {
              testKit: {
                brand: selectedNitrateKit.brand,
                ...(selectedNitrateKit.product
                  ? { product: selectedNitrateKit.product }
                  : {}),
                rawReading,
                ...(selectedNitrateKit.resolution
                  ? { resolution: selectedNitrateKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesPhosphateKit
          ? {
              testKit: {
                brand: selectedPhosphateKit.brand,
                ...(selectedPhosphateKit.product
                  ? { product: selectedPhosphateKit.product }
                  : {}),
                rawReading,
                ...(selectedPhosphateKit.resolution
                  ? { resolution: selectedPhosphateKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(usesIronKit
          ? {
              testKit: {
                brand: selectedIronKit.brand,
                ...(selectedIronKit.product
                  ? { product: selectedIronKit.product }
                  : {}),
                rawReading,
                ...(selectedIronKit.resolution
                  ? { resolution: selectedIronKit.resolution }
                  : {}),
              },
            }
          : {}),
        ...(testNotes.trim() ? { notes: testNotes.trim() } : {}),
      });

      setEvents((current) => [event, ...current].slice(0, 1000));
      setTestValue("");
      setTestSecondaryValue("");
      setTestName("");
      setTestNotes("");
      setTestFormOpen(false);
      setEntryMenuOpen(false);
      onTestSaved?.(event);
      onTestEntryClosed?.();
    } catch (requestError) {
      setFormError(
        requestError instanceof Error
          ? requestError.message
          : String(requestError),
      );
    } finally {
      setSavingTest(false);
    }
  }

  return (
    <>
      {!modalOnly ? (
        <View style={styles.panel}>
      <View style={styles.heading}>
        <Pressable
          accessibilityLabel={panelExpanded ? "Collapse Reef Journal" : "Expand Reef Journal"}
          accessibilityRole="button"
          accessibilityState={{ expanded: panelExpanded }}
          onPress={() => {
            setPanelExpanded((current) => !current);
            setEntryMenuOpen(false);
            setJournalFilterMenuOpen(false);
          }}
          style={styles.headingToggle}
        >
          <View>
            <Text style={styles.eyebrow}>REEF JOURNAL</Text>
            <Text style={styles.title}>Log</Text>
          </View>
          <View style={styles.journalChevron}>
            <DropdownChevron open={panelExpanded} />
          </View>
        </Pressable>

        {panelExpanded ? (
          <CircularActionButton
            accessibilityLabel="Add aquarium log entry"
            kind={entryMenuOpen ? "close" : "add"}
            onPress={() => setEntryMenuOpen((current) => !current)}
          />
        ) : null}
      </View>

      {panelExpanded && entryMenuOpen ? (
        <View style={styles.entryMenu}>
          {["Dose", "Feed", "Maintenance", "Note"].map((label) => (
            <Pressable
              accessibilityRole="button"
              key={label}
              style={styles.entryChoice}
            >
              <Text style={styles.entryChoiceText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}



      {panelExpanded && loading ? (
        <View style={styles.message}>
          <ActivityIndicator color="#20B7EC" />
          <Text style={styles.muted}>Loading journal…</Text>
        </View>
      ) : null}

      {panelExpanded && !loading && error ? (
        <Pressable onPress={() => void refresh()} style={styles.message}>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.retry}>Tap to retry</Text>
        </Pressable>
      ) : null}

      {panelExpanded && !loading && !error && events.length === 0 ? (
        <Text style={styles.empty}>
          No entries yet. Record a test, dose, feeding, or observation.
        </Text>
      ) : null}

      {panelExpanded && !loading && !error && events.length > 0 ? (
        <View style={styles.journalTools}>
          <View style={styles.searchBox}>
            <TextInput
              accessibilityLabel="Search Reef Journal"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setJournalQuery}
              placeholder="Search Reef Journal"
              placeholderTextColor="#71869F"
              returnKeyType="search"
              style={styles.searchInput}
              value={journalQuery}
            />
            {journalQuery ? (
              <Pressable
                accessibilityLabel="Clear journal search"
                accessibilityRole="button"
                onPress={() => setJournalQuery("")}
                style={styles.searchClear}
              >
                <Text style={styles.searchClearText}>×</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.journalFilterControl}>
            <Pressable
              accessibilityLabel="Filter Reef Journal"
              accessibilityRole="button"
              accessibilityState={{ expanded: journalFilterMenuOpen }}
              onPress={() => setJournalFilterMenuOpen((current) => !current)}
              style={styles.journalFilterSelector}
            >
              <Text style={styles.journalFilterSelectorText}>
                {journalFilters.find((item) => item.id === journalFilter)?.label ?? "All"}
              </Text>
              <DropdownChevron open={journalFilterMenuOpen} />
            </Pressable>
            {journalFilterMenuOpen ? (
              <View style={styles.journalFilterMenu}>
                {journalFilters.map((item) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: journalFilter === item.id }}
                    key={item.id}
                    onPress={() => {
                      setJournalFilter(item.id);
                      setJournalFilterMenuOpen(false);
                    }}
                    style={[
                      styles.journalFilterMenuItem,
                      journalFilter === item.id
                        ? styles.journalFilterMenuItemActive
                        : undefined,
                    ]}
                  >
                    <Text style={[
                      styles.journalFilterMenuText,
                      journalFilter === item.id
                        ? styles.journalFilterMenuTextActive
                        : undefined,
                    ]}>
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          <View style={styles.limitChoices}>
            <Text style={styles.resultCount}>
              {filteredEvents.length} {filteredEvents.length === 1 ? "entry" : "entries"}
            </Text>
            {journalLimits.map((item) => (
              <Pressable
                accessibilityRole="button"
                key={item}
                onPress={() => setJournalLimit(item)}
                style={[styles.limitChoice, journalLimit === item ? styles.limitChoiceActive : undefined]}
              >
                <Text style={[styles.limitText, journalLimit === item ? styles.limitTextActive : undefined]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {panelExpanded && !loading && !error && events.length > 0 &&
      filteredEvents.length === 0 ? (
        <Text style={styles.empty}>No journal entries match this search.</Text>
      ) : null}

      {panelExpanded && !loading && !error
        ? filteredEvents.slice(0, visibleJournalCount).map((event, index) => (
            <View
              key={event.id}
              style={[
                styles.eventRow,
                index > 0 ? styles.eventRowBorder : undefined,
              ]}
            >
              <View style={styles.eventBody}>
                <Text style={styles.eventLabel}>
                  {eventLabel(event)}
                </Text>
                <Text numberOfLines={2} style={styles.eventTitle}>
                  {eventTitle(event)}
                </Text>
              </View>

              <View style={styles.eventActions}>
                <Text style={styles.eventTime}>
                  {eventTime(event)}
                </Text>
                {event.type !== "activity" ? <Pressable
                  accessibilityLabel="Delete journal entry"
                  accessibilityRole="button"
                  disabled={deletingEventId === event.id}
                  onPress={() => confirmDelete(event)}
                  style={styles.deleteButton}
                >
                  <Text style={styles.deleteButtonText}>
                    {deletingEventId === event.id ? "…" : "Delete"}
                  </Text>
                </Pressable> : null}
              </View>

              {event.type !== "activity" ? <Pressable
                accessibilityLabel={`Edit ${eventLabel(event).toLowerCase()} journal entry`}
                accessibilityRole="button"
                onPress={() => beginEdit(event)}
                style={styles.eventEditButton}
              >
                <View style={styles.eventEditChevron} />
              </Pressable> : null}
            </View>
          ))
        : null}

      {panelExpanded &&
      !loading &&
      !error &&
      visibleJournalCount < filteredEvents.length ? (
        <Pressable
          accessibilityLabel={`Load ${journalLimit} more journal entries`}
          accessibilityRole="button"
          onPress={() =>
            setVisibleJournalCount((current) =>
              Math.min(current + journalLimit, filteredEvents.length),
            )
          }
          style={styles.loadMoreButton}
        >
          <Text style={styles.loadMoreText}>Load more</Text>
        </Pressable>
      ) : null}
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={closeEdit}
        transparent
        visible={editingEvent !== null}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView
            contentContainerStyle={styles.modalCardContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.eyebrow}>EDIT JOURNAL ENTRY</Text>
                <Text style={styles.formTitle}>
                  {editingEvent ? eventLabel(editingEvent) : ""}
                </Text>
              </View>
              <View style={styles.modalHeaderActions}>
                <CircularActionButton
                  accessibilityLabel="Cancel changes"
                  disabled={savingEdit}
                  kind="cancel"
                  onPress={closeEdit}
                />
                <CircularActionButton
                  accessibilityLabel="Save journal entry"
                  busy={savingEdit}
                  disabled={savingEdit}
                  kind="confirm"
                  onPress={() => void saveEdit()}
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>
              {editingEvent?.type === "measurement"
                ? editingEvent.testKit?.rawReading !== undefined
                  ? (alkalinityKitForEvent(editingEvent)?.inputLabel ??
                    calciumKitForEvent(editingEvent)?.inputLabel ??
                    magnesiumKitForEvent(editingEvent)?.inputLabel ??
                    iodineKitForEvent(editingEvent)?.inputLabel ??
                    nitrateKitForEvent(editingEvent)?.inputLabel ??
                    phosphateKitForEvent(editingEvent)?.inputLabel ??
                    ironKitForEvent(editingEvent)?.inputLabel ??
                    potassiumKitForEvent(editingEvent)?.inputLabel ??
                    "Kit reading")
                  : "Result"
                : editingEvent?.type === "dose"
                  ? "Product"
                  : editingEvent?.type === "feeding"
                    ? "Food"
                    : editingEvent?.type === "maintenance"
                      ? "Activity"
                      : "Observation"}
            </Text>
            <View style={styles.resultRow}>
              {editingEvent?.type === "measurement" &&
              (iodineKitForEvent(editingEvent)?.choices ||
                nitrateKitForEvent(editingEvent)?.choices ||
                phosphateKitForEvent(editingEvent)?.choices ||
                ironKitForEvent(editingEvent)?.choices) ? (
                <View style={styles.readingChoices}>
                  {(iodineKitForEvent(editingEvent)?.choices ??
                    nitrateKitForEvent(editingEvent)?.choices ??
                    phosphateKitForEvent(editingEvent)?.choices ??
                    ironKitForEvent(editingEvent)!.choices!).map((choice) => (
                    <Pressable
                      accessibilityRole="button"
                      key={choice.value}
                      onPress={() => setEditPrimary(String(choice.value))}
                      style={[
                        styles.readingChoice,
                        { backgroundColor: choice.color },
                        Number(editPrimary) === choice.value
                          ? styles.readingChoiceActive
                          : undefined,
                      ]}
                    >
                      <Text
                        style={[
                          styles.readingChoiceText,
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
                  accessibilityLabel="Journal entry value"
                  editable={!savingEdit}
                  keyboardType={
                    editingEvent?.type === "measurement"
                      ? "decimal-pad"
                      : "default"
                  }
                  onChangeText={setEditPrimary}
                  style={styles.input}
                  value={editPrimary}
                />
              )}
              {editingEvent?.type === "measurement" ? (
                <Text style={styles.unit}>
                  {editingEvent.testKit?.rawReading !== undefined
                    ? (alkalinityKitForEvent(editingEvent)?.inputUnit ??
                      calciumKitForEvent(editingEvent)?.inputUnit ??
                      magnesiumKitForEvent(editingEvent)?.inputUnit ??
                      iodineKitForEvent(editingEvent)?.inputUnit ??
                      nitrateKitForEvent(editingEvent)?.inputUnit ??
                      phosphateKitForEvent(editingEvent)?.inputUnit ??
                      ironKitForEvent(editingEvent)?.inputUnit ??
                      potassiumKitForEvent(editingEvent)?.inputUnit ??
                      editingEvent.unit)
                    : editingEvent.unit}
                </Text>
              ) : null}
            </View>

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            alkalinityKitForEvent(editingEvent) &&
            readingIsValid(
              alkalinityKitForEvent(editingEvent)!,
              Number(editPrimary),
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>
                  Calculated alkalinity
                </Text>
                <Text style={styles.calculatedValue}>
                  {alkalinityKitForEvent(editingEvent)!
                    .calculateDkh(Number(editPrimary))
                    .toFixed(
                      alkalinityKitForEvent(editingEvent)!
                        .resultDecimals,
                    )}{" "}
                  dKH
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            phosphateKitForEvent(editingEvent) &&
            phosphateReadingIsValid(
              phosphateKitForEvent(editingEvent)!,
              Number(editPrimary),
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>Phosphate result</Text>
                <Text style={styles.calculatedValue}>
                  {phosphateResultLabel(
                    phosphateKitForEvent(editingEvent)!,
                    phosphateKitForEvent(editingEvent)!.calculatePpm(
                      Number(editPrimary),
                    ),
                  )}
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            ironKitForEvent(editingEvent) &&
            ironReadingIsValid(
              ironKitForEvent(editingEvent)!,
              Number(editPrimary),
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>Iron result</Text>
                <Text style={styles.calculatedValue}>
                  {ironResultLabel(
                    ironKitForEvent(editingEvent)!,
                    ironKitForEvent(editingEvent)!.calculatePpm(Number(editPrimary)),
                  )}
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            nitrateKitForEvent(editingEvent) &&
            nitrateReadingIsValid(
              nitrateKitForEvent(editingEvent)!,
              Number(editPrimary),
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>Nitrate result</Text>
                <Text style={styles.calculatedValue}>
                  {nitrateResultLabel(
                    nitrateKitForEvent(editingEvent)!,
                    nitrateKitForEvent(editingEvent)!.calculatePpm(
                      Number(editPrimary),
                    ),
                  )}
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            calciumKitForEvent(editingEvent)?.secondaryInput ? (
              <>
                <Text style={styles.fieldLabel}>
                  {calciumKitForEvent(editingEvent)!.secondaryInput!.label}
                </Text>
                <View style={styles.resultRow}>
                  <TextInput
                    accessibilityLabel="Secondary kit reading"
                    editable={!savingEdit}
                    keyboardType="decimal-pad"
                    onChangeText={setEditSecondary}
                    style={styles.input}
                    value={editSecondary}
                  />
                  <Text style={styles.unit}>
                    {calciumKitForEvent(editingEvent)!.secondaryInput!.unit}
                  </Text>
                </View>
              </>
            ) : null}

            {editingEvent?.type === "measurement" &&
            magnesiumKitForEvent(editingEvent)?.secondaryInput ? (
              <>
                <Text style={styles.fieldLabel}>
                  {magnesiumKitForEvent(editingEvent)!.secondaryInput!.label}
                </Text>
                <View style={styles.resultRow}>
                  <TextInput
                    accessibilityLabel="Secondary kit reading"
                    editable={!savingEdit}
                    keyboardType="decimal-pad"
                    onChangeText={setEditSecondary}
                    style={styles.input}
                    value={editSecondary}
                  />
                  <Text style={styles.unit}>
                    {magnesiumKitForEvent(editingEvent)!.secondaryInput!.unit}
                  </Text>
                </View>
              </>
            ) : null}

            {editingEvent?.type === "measurement" &&
            potassiumKitForEvent(editingEvent)?.secondaryInput ? (
              <>
                <Text style={styles.fieldLabel}>
                  {potassiumKitForEvent(editingEvent)!.secondaryInput!.label}
                </Text>
                <View style={styles.resultRow}>
                  <TextInput
                    accessibilityLabel="Secondary kit reading"
                    editable={!savingEdit}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={setEditSecondary}
                    style={styles.input}
                    value={editSecondary}
                  />
                  <Text style={styles.unit}>
                    {potassiumKitForEvent(editingEvent)!.secondaryInput!.unit}
                  </Text>
                </View>
              </>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            calciumKitForEvent(editingEvent) &&
            calciumReadingIsValid(
              calciumKitForEvent(editingEvent)!,
              Number(editPrimary),
              calciumKitForEvent(editingEvent)!.secondaryInput
                ? Number(editSecondary)
                : undefined,
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>
                  Calculated calcium
                </Text>
                <Text style={styles.calculatedValue}>
                  {calciumKitForEvent(editingEvent)!
                    .calculatePpm(
                      Number(editPrimary),
                      calciumKitForEvent(editingEvent)!.secondaryInput
                        ? Number(editSecondary)
                        : undefined,
                    )
                    .toFixed(
                      calciumKitForEvent(editingEvent)!.resultDecimals,
                    )}{" "}
                  ppm
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            magnesiumKitForEvent(editingEvent) &&
            magnesiumReadingIsValid(
              magnesiumKitForEvent(editingEvent)!,
              Number(editPrimary),
              magnesiumKitForEvent(editingEvent)!.secondaryInput
                ? Number(editSecondary)
                : undefined,
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>
                  Calculated magnesium
                </Text>
                <Text style={styles.calculatedValue}>
                  {magnesiumKitForEvent(editingEvent)!
                    .calculatePpm(
                      Number(editPrimary),
                      magnesiumKitForEvent(editingEvent)!.secondaryInput
                        ? Number(editSecondary)
                        : undefined,
                    )
                    .toFixed(
                      magnesiumKitForEvent(editingEvent)!.resultDecimals,
                    )}{" "}
                  ppm
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            iodineKitForEvent(editingEvent) &&
            iodineReadingIsValid(
              iodineKitForEvent(editingEvent)!,
              Number(editPrimary),
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>Iodine result</Text>
                <Text style={styles.calculatedValue}>
                  {iodineResultLabel(
                    iodineKitForEvent(editingEvent)!,
                    iodineKitForEvent(editingEvent)!.calculatePpm(
                      Number(editPrimary),
                    ),
                  )}
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "measurement" &&
            editingEvent.testKit?.rawReading !== undefined &&
            potassiumKitForEvent(editingEvent) &&
            potassiumReadingIsValid(
              potassiumKitForEvent(editingEvent)!,
              Number(editPrimary),
              potassiumKitForEvent(editingEvent)!.secondaryInput
                ? Number(editSecondary)
                : undefined,
            ) ? (
              <View style={styles.calculatedResult}>
                <Text style={styles.calculatedLabel}>
                  Calculated potassium
                </Text>
                <Text style={styles.calculatedValue}>
                  {potassiumResultLabel(
                    potassiumKitForEvent(editingEvent)!,
                    Number(editPrimary),
                    potassiumKitForEvent(editingEvent)!.calculatePpm(
                      Number(editPrimary),
                      potassiumKitForEvent(editingEvent)!.secondaryInput
                        ? Number(editSecondary)
                        : undefined,
                    ),
                  )}
                </Text>
              </View>
            ) : null}

            {editingEvent?.type === "dose" ||
            editingEvent?.type === "feeding" ? (
              <>
                <Text style={styles.fieldLabel}>
                  Amount{editingEvent.type === "feeding" ? " (optional)" : ""}
                </Text>
                <View style={styles.editAmountRow}>
                  <TextInput
                    accessibilityLabel="Journal entry amount"
                    editable={!savingEdit}
                    keyboardType="decimal-pad"
                    onChangeText={setEditAmount}
                    placeholder="Amount"
                    placeholderTextColor="#607A98"
                    style={styles.input}
                    value={editAmount}
                  />
                  <TextInput
                    accessibilityLabel="Journal entry unit"
                    editable={!savingEdit}
                    onChangeText={setEditUnit}
                    placeholder="Unit"
                    placeholderTextColor="#607A98"
                    style={[styles.input, styles.editUnitInput]}
                    value={editUnit}
                  />
                </View>
              </>
            ) : null}

            {editingEvent?.type === "maintenance" ||
            editingEvent?.type === "observation" ? (
              <>
                <Text style={styles.fieldLabel}>
                  {editingEvent.type === "maintenance"
                    ? "Details (optional)"
                    : "Category (optional)"}
                </Text>
                <TextInput
                  accessibilityLabel="Journal entry details"
                  editable={!savingEdit}
                  multiline={editingEvent.type === "maintenance"}
                  onChangeText={setEditSecondary}
                  style={[
                    styles.input,
                    editingEvent.type === "maintenance"
                      ? styles.notesInput
                      : undefined,
                  ]}
                  value={editSecondary}
                />
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Date and time</Text>
            <View style={styles.editDateTimeRow}>
              <TextInput
                accessibilityLabel="Journal entry date"
                editable={!savingEdit}
                onChangeText={setEditDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#607A98"
                style={[styles.input, styles.editDateInput]}
                value={editDate}
              />
              <TextInput
                accessibilityLabel="Journal entry time"
                editable={!savingEdit}
                onChangeText={setEditTime}
                placeholder="HH:MM"
                placeholderTextColor="#607A98"
                style={[styles.input, styles.editTimeInput]}
                value={editTime}
              />
            </View>

            <Text style={styles.fieldLabel}>Comment (optional)</Text>
            <TextInput
              accessibilityLabel="Journal entry comment"
              editable={!savingEdit}
              multiline
              onChangeText={setEditNotes}
              placeholderTextColor="#607A98"
              style={[styles.input, styles.notesInput]}
              value={editNotes}
            />

            {editError ? (
              <Text style={styles.formError}>{editError}</Text>
            ) : null}

          </ScrollView>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeNoteForm}
        transparent
        visible={noteFormOpen}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView
            contentContainerStyle={styles.modalCardContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.modalCard}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.eyebrow}>REEF JOURNAL</Text>
                <Text style={styles.formTitle}>Add note</Text>
              </View>
              <View style={styles.modalHeaderActions}>
                <CircularActionButton
                  accessibilityLabel="Cancel note"
                  disabled={savingNote}
                  kind="cancel"
                  onPress={closeNoteForm}
                />
                <CircularActionButton
                  accessibilityLabel="Save note"
                  busy={savingNote}
                  disabled={savingNote || !noteObservation.trim()}
                  kind="confirm"
                  onPress={() => void saveNote()}
                />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Note</Text>
            <TextInput
              accessibilityLabel="Journal note"
              autoFocus
              editable={!savingNote}
              multiline
              onChangeText={setNoteObservation}
              placeholder="What did you observe?"
              placeholderTextColor="#71869F"
              style={[styles.input, styles.noteObservationInput]}
              value={noteObservation}
            />
            <Text style={styles.fieldLabel}>Category (optional)</Text>
            <TextInput
              accessibilityLabel="Note category"
              editable={!savingNote}
              onChangeText={setNoteCategory}
              placeholder="Livestock, coral, water, equipment…"
              placeholderTextColor="#71869F"
              style={styles.input}
              value={noteCategory}
            />
            <Text style={styles.fieldLabel}>Additional details (optional)</Text>
            <TextInput
              accessibilityLabel="Additional note details"
              editable={!savingNote}
              multiline
              onChangeText={setNoteDetails}
              placeholder="Add any supporting details"
              placeholderTextColor="#71869F"
              style={[styles.input, styles.notesInput]}
              value={noteDetails}
            />
            {noteError ? <Text style={styles.formError}>{noteError}</Text> : null}
          </ScrollView>
        </View>
      </Modal>

      {testFormOpen ? (
        <Modal
          animationType="fade"
          onRequestClose={() => {
            setTestFormOpen(false);
            setFormError(null);
            onTestEntryClosed?.();
          }}
          transparent
          visible
        >
          <View style={styles.modalBackdrop}>
            <ScrollView
              contentContainerStyle={styles.modalCardContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.modalCard}
            >
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderCopy}>
              <Text style={styles.formTitle}>Log water test</Text>
            </View>
            <View style={styles.modalHeaderActions}>
              <CircularActionButton
                accessibilityLabel="Cancel water test"
                disabled={savingTest}
                kind="cancel"
                onPress={() => {
                  setTestFormOpen(false);
                  setFormError(null);
                  onTestEntryClosed?.();
                }}
              />
              <CircularActionButton
                accessibilityLabel="Save water test"
                busy={savingTest}
                disabled={
                  savingTest ||
                  testValue.trim() === "" ||
                  (testParameter === "other" && testName.trim() === "")
                }
                kind="confirm"
                onPress={() => void saveTest()}
              />
            </View>
          </View>

          <Text style={styles.fieldLabel}>Parameter</Text>
          <View style={styles.selectorStack}>
            <Pressable
              accessibilityLabel="Choose test parameter"
              accessibilityRole="button"
              onPress={() => setParameterMenuOpen((open) => !open)}
              style={styles.selector}
            >
              <Text style={styles.selectorText}>
                {selectedParameterOption?.label ?? "Other"}
              </Text>
              <DropdownChevron open={parameterMenuOpen} />
            </Pressable>
            {parameterMenuOpen ? (
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator
                style={[styles.selectorMenu, styles.parameterSelectorMenu]}
              >
                {testParameterOptions.map((item) => {
                  const active =
                    item.parameter === testParameter &&
                    (item.parameter !== "other" ||
                      (item.name ?? "").toLocaleLowerCase() ===
                        testName.trim().toLocaleLowerCase());

                  return (
                    <Pressable
                      accessibilityRole="button"
                      key={`${item.parameter}:${item.name ?? "base"}`}
                      onPress={() => {
                        setTestParameter(item.parameter);
                        setTestName(item.name ?? "");
                        setTestValue("");
                        setTestSecondaryValue("");
                        setFormError(null);
                        setParameterMenuOpen(false);
                        setManufacturerMenuOpen(false);
                        setOptionMenuOpen(false);
                      }}
                      style={[
                        styles.selectorMenuItem,
                        active ? styles.selectorMenuItemActive : undefined,
                      ]}
                    >
                      <Text style={styles.selectorMenuText}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          {testParameter === "other" ? (
            <>
              <Text style={styles.fieldLabel}>Test name</Text>
              <TextInput
                accessibilityLabel="Custom test name"
                editable={!savingTest && !selectedParameterOption?.name}
                onChangeText={setTestName}
                placeholder="Required, for example Strontium"
                placeholderTextColor="#607A98"
                style={styles.input}
                value={testName}
              />
            </>
          ) : null}

          {testParameter === "alkalinity" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setManufacturerMenuOpen((open) => !open)
                  }
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedAlkalinityKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {alkalinityManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() => selectManufacturer(brand)}
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedAlkalinityKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>
                          {brand}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {selectedAlkalinityKit.optionField}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {selectedAlkalinityKit.optionLabel}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {optionMenuOpen ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>
                            {kit.optionLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "calcium" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setManufacturerMenuOpen((open) => !open)
                  }
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedCalciumKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {calciumManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() =>
                          selectCalciumManufacturer(brand)
                        }
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedCalciumKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>
                          {brand}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedCalciumBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {selectedCalciumKit.optionField}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {selectedCalciumKit.optionLabel}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {optionMenuOpen ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedCalciumBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>
                            {kit.optionLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "magnesium" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setManufacturerMenuOpen((open) => !open)
                  }
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedMagnesiumKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {magnesiumManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() =>
                          selectMagnesiumManufacturer(brand)
                        }
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedMagnesiumKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>
                          {brand}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedMagnesiumBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {selectedMagnesiumKit.optionField}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {selectedMagnesiumKit.optionLabel}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {optionMenuOpen ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedMagnesiumBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>
                            {kit.optionLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "potassium" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setManufacturerMenuOpen((open) => !open)
                  }
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedPotassiumKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {potassiumManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() =>
                          selectPotassiumManufacturer(brand)
                        }
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedPotassiumKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>
                          {brand}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {testParameter === "iodine" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setManufacturerMenuOpen((open) => !open)
                  }
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedIodineKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {iodineManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() => selectIodineManufacturer(brand)}
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedIodineKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>{brand}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedIodineBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {selectedIodineKit.optionField}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {selectedIodineKit.optionLabel}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {optionMenuOpen ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedIodineBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>
                            {kit.optionLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "nitrate" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setManufacturerMenuOpen((open) => !open)}
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedNitrateKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {nitrateManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() => selectNitrateManufacturer(brand)}
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedNitrateKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>{brand}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedNitrateBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {selectedNitrateKit.optionField}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {selectedNitrateKit.optionLabel}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {optionMenuOpen ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedNitrateBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>
                            {kit.optionLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "phosphate" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setManufacturerMenuOpen((open) => !open)}
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>
                    {selectedPhosphateKit.brand}
                  </Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View
                    style={[
                      styles.selectorMenu,
                      styles.selectorMenuOverlay,
                      compactLandscapeMenu
                        ? styles.selectorMenuLandscape
                        : undefined,
                    ]}
                  >
                    {phosphateManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() => selectPhosphateManufacturer(brand)}
                        style={[
                          styles.selectorMenuItem,
                          compactLandscapeMenu
                            ? styles.selectorMenuItemLandscape
                            : undefined,
                          selectedPhosphateKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>{brand}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedPhosphateBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {selectedPhosphateKit.optionField}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>
                      {selectedPhosphateKit.optionLabel}
                    </Text>
                    <Text style={styles.selectorArrow}>
                      {optionMenuOpen ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedPhosphateBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>
                            {kit.optionLabel}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "iron" ? (
            <>
              <Text style={styles.fieldLabel}>Test kit</Text>
              <View style={styles.selectorStack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setManufacturerMenuOpen((open) => !open)}
                  style={styles.selector}
                >
                  <Text style={styles.selectorText}>{selectedIronKit.brand}</Text>
                  <Text style={styles.selectorArrow}>
                    {manufacturerMenuOpen ? "▲" : "▼"}
                  </Text>
                </Pressable>
                {manufacturerMenuOpen ? (
                  <View style={[styles.selectorMenu, styles.selectorMenuOverlay]}>
                    {ironManufacturers.map((brand) => (
                      <Pressable
                        key={brand}
                        onPress={() => selectIronManufacturer(brand)}
                        style={[
                          styles.selectorMenuItem,
                          selectedIronKit.brand === brand
                            ? styles.selectorMenuItemActive
                            : undefined,
                        ]}
                      >
                        <Text style={styles.selectorMenuText}>{brand}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>

              {selectedIronBrandKits.length > 1 ? (
                <>
                  <Text style={styles.fieldLabel}>{selectedIronKit.optionField}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOptionMenuOpen((open) => !open)}
                    style={styles.selector}
                  >
                    <Text style={styles.selectorText}>{selectedIronKit.optionLabel}</Text>
                    <Text style={styles.selectorArrow}>{optionMenuOpen ? "▲" : "▼"}</Text>
                  </Pressable>
                  {optionMenuOpen ? (
                    <View style={styles.selectorMenu}>
                      {selectedIronBrandKits.map((kit) => (
                        <Pressable
                          key={kit.id}
                          onPress={() => void selectTestKit(kit.id)}
                          style={[
                            styles.selectorMenuItem,
                            selectedTestKit === kit.id
                              ? styles.selectorMenuItemActive
                              : undefined,
                          ]}
                        >
                          <Text style={styles.selectorMenuText}>{kit.optionLabel}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {testParameter === "alkalinity" ||
          testParameter === "calcium" ||
          testParameter === "magnesium" ||
          testParameter === "potassium" ||
          testParameter === "iodine" ||
          testParameter === "nitrate" ||
          testParameter === "phosphate" ||
          testParameter === "iron" ? (
            <Text style={styles.guidance}>
              {testParameter === "alkalinity"
                ? selectedAlkalinityKit.guidance
                : testParameter === "calcium"
                  ? selectedCalciumKit.guidance
                  : testParameter === "magnesium"
                    ? selectedMagnesiumKit.guidance
                    : testParameter === "potassium"
                      ? selectedPotassiumKit.guidance
                      : testParameter === "iodine"
                        ? selectedIodineKit.guidance
                        : testParameter === "nitrate"
                          ? selectedNitrateKit.guidance
                          : testParameter === "phosphate"
                            ? selectedPhosphateKit.guidance
                            : selectedIronKit.guidance}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>
            {testParameter === "alkalinity"
              ? selectedAlkalinityKit.inputLabel
              : testParameter === "calcium"
                ? selectedCalciumKit.inputLabel
                : testParameter === "magnesium"
                  ? selectedMagnesiumKit.inputLabel
                  : testParameter === "potassium"
                    ? selectedPotassiumKit.inputLabel
                    : testParameter === "iodine"
                      ? selectedIodineKit.inputLabel
                      : testParameter === "nitrate"
                        ? selectedNitrateKit.inputLabel
                        : testParameter === "phosphate"
                          ? selectedPhosphateKit.inputLabel
                          : testParameter === "iron"
                            ? selectedIronKit.inputLabel
                    : "Result"}
          </Text>
          <View style={styles.resultRow}>
            {(testParameter === "iodine" && selectedIodineKit.choices) ||
            (testParameter === "nitrate" && selectedNitrateKit.choices) ||
            (testParameter === "phosphate" && selectedPhosphateKit.choices) ||
            (testParameter === "iron" && selectedIronKit.choices) ? (
              <View style={styles.readingChoices}>
                {(testParameter === "iodine"
                  ? selectedIodineKit.choices!
                  : testParameter === "nitrate"
                    ? selectedNitrateKit.choices!
                    : testParameter === "phosphate"
                      ? selectedPhosphateKit.choices!
                      : selectedIronKit.choices!
                ).map((choice) => (
                  <Pressable
                    accessibilityRole="button"
                    key={choice.value}
                    onPress={() => setTestValue(String(choice.value))}
                    style={[
                      styles.readingChoice,
                      { backgroundColor: choice.color },
                      rawReading === choice.value
                        ? styles.readingChoiceActive
                        : undefined,
                    ]}
                  >
                    <Text
                      style={[
                        styles.readingChoiceText,
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
                editable={!savingTest}
                keyboardType="decimal-pad"
                onChangeText={setTestValue}
                placeholder={
                  testParameter === "alkalinity"
                    ? selectedAlkalinityKit.minimum.toFixed(
                        selectedAlkalinityKit.decimals,
                      )
                    : testParameter === "calcium"
                      ? selectedCalciumKit.minimum.toFixed(
                          selectedCalciumKit.decimals,
                        )
                      : testParameter === "magnesium"
                        ? selectedMagnesiumKit.minimum.toFixed(
                            selectedMagnesiumKit.decimals,
                          )
                        : testParameter === "potassium"
                          ? selectedPotassiumKit.minimum.toFixed(
                              selectedPotassiumKit.decimals,
                            )
                          : testParameter === "iodine"
                            ? selectedIodineKit.minimum.toFixed(
                                selectedIodineKit.decimals,
                              )
                            : testParameter === "nitrate"
                              ? selectedNitrateKit.minimum.toFixed(
                                  selectedNitrateKit.decimals,
                                )
                              : testParameter === "phosphate"
                                ? selectedPhosphateKit.minimum.toFixed(
                                    selectedPhosphateKit.decimals,
                                  )
                                : testParameter === "iron"
                                  ? selectedIronKit.minimum.toFixed(
                                      selectedIronKit.decimals,
                                    )
                            : "0.00"
                }
                placeholderTextColor="#607A98"
                style={styles.input}
                value={testValue}
              />
            )}
            <Text style={styles.unit}>
              {testParameter === "alkalinity"
                ? selectedAlkalinityKit.inputUnit
                : testParameter === "calcium"
                  ? selectedCalciumKit.inputUnit
                  : testParameter === "magnesium"
                    ? selectedMagnesiumKit.inputUnit
                    : testParameter === "potassium"
                      ? selectedPotassiumKit.inputUnit
                      : testParameter === "iodine"
                        ? selectedIodineKit.inputUnit
                        : testParameter === "nitrate"
                          ? selectedNitrateKit.inputUnit
                          : testParameter === "phosphate"
                            ? selectedPhosphateKit.inputUnit
                            : testParameter === "iron"
                              ? selectedIronKit.inputUnit
                      : selectedParameterOption?.unit}
            </Text>
          </View>

          {testParameter === "calcium" &&
          selectedCalciumKit.secondaryInput ? (
            <>
              <Text style={styles.fieldLabel}>
                {selectedCalciumKit.secondaryInput.label}
              </Text>
              <View style={styles.resultRow}>
                <TextInput
                  accessibilityLabel="Secondary test result"
                  editable={!savingTest}
                  keyboardType="decimal-pad"
                  onChangeText={setTestSecondaryValue}
                  placeholder={selectedCalciumKit.secondaryInput.minimum.toFixed(
                    selectedCalciumKit.secondaryInput.decimals,
                  )}
                  placeholderTextColor="#607A98"
                  style={styles.input}
                  value={testSecondaryValue}
                />
                <Text style={styles.unit}>
                  {selectedCalciumKit.secondaryInput.unit}
                </Text>
              </View>
            </>
          ) : null}

          {testParameter === "magnesium" &&
          selectedMagnesiumKit.secondaryInput ? (
            <>
              <Text style={styles.fieldLabel}>
                {selectedMagnesiumKit.secondaryInput.label}
              </Text>
              <View style={styles.resultRow}>
                <TextInput
                  accessibilityLabel="Secondary test result"
                  editable={!savingTest}
                  keyboardType="decimal-pad"
                  onChangeText={setTestSecondaryValue}
                  placeholder={selectedMagnesiumKit.secondaryInput.minimum.toFixed(
                    selectedMagnesiumKit.secondaryInput.decimals,
                  )}
                  placeholderTextColor="#607A98"
                  style={styles.input}
                  value={testSecondaryValue}
                />
                <Text style={styles.unit}>
                  {selectedMagnesiumKit.secondaryInput.unit}
                </Text>
              </View>
            </>
          ) : null}

          {testParameter === "potassium" &&
          selectedPotassiumKit.secondaryInput ? (
            <>
              <Text style={styles.fieldLabel}>
                {selectedPotassiumKit.secondaryInput.label}
              </Text>
              <View style={styles.resultRow}>
                <TextInput
                  accessibilityLabel="Secondary test result"
                  editable={!savingTest}
                  keyboardType="numbers-and-punctuation"
                  onChangeText={setTestSecondaryValue}
                  placeholder={selectedPotassiumKit.secondaryInput.minimum.toFixed(
                    selectedPotassiumKit.secondaryInput.decimals,
                  )}
                  placeholderTextColor="#607A98"
                  style={styles.input}
                  value={testSecondaryValue}
                />
                <Text style={styles.unit}>
                  {selectedPotassiumKit.secondaryInput.unit}
                </Text>
              </View>
            </>
          ) : null}

          {testParameter === "iodine" &&
          selectedTestKit !== "iodine-direct" &&
          calculatedIodinePpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>Iodine result</Text>
              <Text style={styles.calculatedValue}>
                {iodineResultLabel(selectedIodineKit, calculatedIodinePpm)}
              </Text>
            </View>
          ) : null}

          {testParameter === "nitrate" &&
          selectedTestKit !== "nitrate-direct" &&
          calculatedNitratePpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>Nitrate result</Text>
              <Text style={styles.calculatedValue}>
                {nitrateResultLabel(selectedNitrateKit, calculatedNitratePpm)}
              </Text>
            </View>
          ) : null}

          {testParameter === "phosphate" &&
          selectedTestKit !== "phosphate-direct" &&
          calculatedPhosphatePpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>Phosphate result</Text>
              <Text style={styles.calculatedValue}>
                {phosphateResultLabel(
                  selectedPhosphateKit,
                  calculatedPhosphatePpm,
                )}
              </Text>
            </View>
          ) : null}

          {testParameter === "iron" &&
          selectedTestKit !== "iron-direct" &&
          calculatedIronPpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>Iron result</Text>
              <Text style={styles.calculatedValue}>
                {ironResultLabel(selectedIronKit, calculatedIronPpm)}
              </Text>
            </View>
          ) : null}

          {testParameter === "alkalinity" &&
          selectedTestKit !== "direct" &&
          calculatedDkh !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>
                Calculated alkalinity
              </Text>
              <Text style={styles.calculatedValue}>
                {calculatedDkh.toFixed(
                  selectedAlkalinityKit.resultDecimals,
                )} dKH
              </Text>
            </View>
          ) : null}

          {testParameter === "magnesium" &&
          selectedTestKit !== "magnesium-direct" &&
          calculatedMagnesiumPpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>
                Calculated magnesium
              </Text>
              <Text style={styles.calculatedValue}>
                {calculatedMagnesiumPpm.toFixed(
                  selectedMagnesiumKit.resultDecimals,
                )}{" "}
                ppm
              </Text>
            </View>
          ) : null}

          {testParameter === "potassium" &&
          selectedTestKit !== "potassium-direct" &&
          calculatedPotassiumPpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>
                Calculated potassium
              </Text>
              <Text style={styles.calculatedValue}>
                {potassiumResultLabel(
                  selectedPotassiumKit,
                  rawReading,
                  calculatedPotassiumPpm,
                )}
              </Text>
            </View>
          ) : null}

          {testParameter === "calcium" &&
          selectedTestKit !== "calcium-direct" &&
          calculatedCalciumPpm !== null ? (
            <View style={styles.calculatedResult}>
              <Text style={styles.calculatedLabel}>
                Calculated calcium
              </Text>
              <Text style={styles.calculatedValue}>
                {calculatedCalciumPpm.toFixed(
                  selectedCalciumKit.resultDecimals,
                )}{" "}
                ppm
              </Text>
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Comment (optional)</Text>
          <TextInput
            accessibilityLabel="Test comment"
            editable={!savingTest}
            multiline
            onChangeText={setTestNotes}
            placeholder="Kit, conditions, or anything unusual"
            placeholderTextColor="#607A98"
            style={[styles.input, styles.notesInput]}
            value={testNotes}
          />

          {formError ? (
            <Text style={styles.formError}>{formError}</Text>
          ) : null}

            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(2, 10, 22, 0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#061B31",
    borderColor: "#20B7EC",
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: "92%",
    maxWidth: 620,
    width: "100%",
  },
  modalCardContent: {
    padding: 18,
  },
  modalHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  modalHeaderCopy: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  modalHeaderActions: {
    flexDirection: "row",
    gap: 8,
  },
  panel: {
    backgroundColor: "#08213D",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 28,
    padding: 18,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headingToggle: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 38,
  },
  journalChevron: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  eyebrow: {
    color: "#20B7EC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 19,
    fontWeight: "700",
    marginTop: 3,
  },
  entryMenu: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  entryChoice: {
    backgroundColor: "#0A2949",
    borderColor: "#214869",
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  entryChoiceText: {
    color: "#C8D7E8",
    fontSize: 13,
    fontWeight: "700",
  },
  entryChoiceActive: {
    backgroundColor: "#123C64",
    borderColor: "#20B7EC",
  },
  form: {
    backgroundColor: "#061B31",
    borderColor: "#153E63",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 14,
    padding: 15,
  },
  formTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
  },
  fieldLabel: {
    color: "#9FB1C7",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 7,
    marginTop: 14,
  },
  parameterChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  parameterChoice: {
    borderColor: "#214869",
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  parameterChoiceActive: {
    backgroundColor: "#20B7EC",
    borderColor: "#20B7EC",
  },
  parameterChoiceText: {
    color: "#B8C7D9",
    fontSize: 12,
    fontWeight: "700",
  },
  parameterChoiceTextActive: {
    color: "#061528",
  },
  selector: {
    alignItems: "center",
    backgroundColor: "#08213D",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  selectorStack: {
    position: "relative",
    zIndex: 20,
  },
  selectorText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  selectorArrow: {
    color: "#20B7EC",
    fontSize: 11,
  },
  selectorMenu: {
    backgroundColor: "#061528",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  parameterSelectorMenu: {
    maxHeight: 280,
  },
  selectorMenuOverlay: {
    left: 0,
    marginTop: 0,
    position: "absolute",
    right: 0,
    top: "100%",
    zIndex: 30,
  },
  selectorMenuLandscape: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  selectorMenuItem: {
    borderBottomColor: "#164975",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectorMenuItemLandscape: {
    width: "33.333333%",
  },
  selectorMenuItemActive: {
    backgroundColor: "#133A67",
  },
  selectorMenuText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  resultRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  readingChoices: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  readingChoice: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 2,
    flexGrow: 1,
    minWidth: 54,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  readingChoiceActive: {
    borderColor: "#FFFFFF",
  },
  readingChoiceText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  editAmountRow: {
    flexDirection: "row",
    gap: 10,
  },
  editUnitInput: {
    flex: 0.55,
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
  input: {
    backgroundColor: "#08213D",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    color: "#FFFFFF",
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  unit: {
    color: "#8FA4BF",
    fontSize: 14,
    minWidth: 36,
  },
  guidance: {
    color: "#9FB1C7",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  calculatedResult: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  calculatedLabel: {
    color: "#9FB1C7",
    fontSize: 12,
    fontWeight: "700",
  },
  calculatedValue: {
    color: "#20B7EC",
    fontSize: 16,
    fontWeight: "800",
  },
  notesInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  noteObservationInput: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  formError: {
    color: "#FCA5A5",
    fontSize: 12,
    marginTop: 10,
  },
  buttonDisabled: {
    backgroundColor: "#345673",
    opacity: 0.55,
  },
  message: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 22,
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
    lineHeight: 19,
    paddingVertical: 20,
  },
  journalTools: {
    borderBottomColor: "#153E63",
    borderBottomWidth: 1,
    gap: 10,
    marginTop: 14,
    paddingBottom: 14,
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: "#061B31",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 42,
  },
  searchInput: {
    color: "#FFFFFF",
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchClear: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  searchClearText: {
    color: "#20B7EC",
    fontSize: 24,
    lineHeight: 26,
  },
  journalFilterControl: {
    position: "relative",
    zIndex: 10,
  },
  journalFilterSelector: {
    alignItems: "center",
    backgroundColor: "#061B31",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  journalFilterSelectorText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  journalFilterMenu: {
    backgroundColor: "#061528",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 46,
    zIndex: 20,
  },
  journalFilterMenuItem: {
    borderBottomColor: "#164975",
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  journalFilterMenuItemActive: {
    backgroundColor: "#133A67",
  },
  journalFilterMenuText: {
    color: "#B8C7D9",
    fontSize: 13,
    fontWeight: "700",
  },
  journalFilterMenuTextActive: {
    color: "#FFFFFF",
  },
  limitChoices: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  resultCount: {
    color: "#7890AC",
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
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
    marginTop: 4,
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
    gap: 14,
    minHeight: 62,
  },
  eventEditButton: {
    alignItems: "center",
    height: 34,
    justifyContent: "center",
    width: 24,
  },
  eventEditChevron: {
    borderRightColor: "#20B7EC",
    borderRightWidth: 2,
    borderTopColor: "#20B7EC",
    borderTopWidth: 2,
    height: 9,
    transform: [{ rotate: "45deg" }, { translateX: -1 }],
    width: 9,
  },
  eventRowBorder: {
    borderTopColor: "#102F50",
    borderTopWidth: 1,
  },
  eventBody: {
    flex: 1,
  },
  eventLabel: {
    color: "#20B7EC",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  eventTitle: {
    color: "#E9F2F5",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 3,
  },
  eventActions: {
    alignItems: "flex-end",
    gap: 7,
  },
  eventTime: {
    color: "#7890AC",
    fontSize: 11,
    textAlign: "right",
  },
  deleteButton: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  deleteButtonText: {
    color: "#FCA5A5",
    fontSize: 11,
    fontWeight: "700",
  },
});
