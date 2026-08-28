import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import {
  getEquipmentById,
  getEquipmentControlMode,
  type AquariumDigitalTwin,
  type AquariumEvent,
  type Equipment,
  type EquipmentControlMode,
  type EquipmentRole,
  type WaterMeasurement,
  type WaterParameter,
} from "@modreef/digital-twin";
import { ModReefHttpError } from "@modreef/cloud-client";
import {
  buildReefCoachReport,
  type AquariumSummary,
  type EdgeSummary,
  type ReefCoachReport,
} from "@modreef/api-contract";

import { demoTwin } from "./src/demoTwin";
import { CloudAuthGate, useCloudAuth } from "./src/CloudAuthGate";
import { CloudAquariumSetup } from "./src/CloudAquariumSetup";
import { CloudEdgeSetup } from "./src/CloudEdgeSetup";
import { CommunityControllerDownload } from "./src/CommunityControllerDownload";
import { isCommunityDownloadPath } from "./src/communityControllerRelease";
import { dashboardConnectionMode } from "./src/connectionMode";
import {
  soleControllerForDeviceAdministration,
} from "./src/deviceOnboardingAuthorization";
import { EquipmentProgramPanel } from "./src/EquipmentProgramPanel";
import {
  isDmpWavemaker,
  WavemakerProgramPanel,
} from "./src/WavemakerProgramPanel";
import { equipmentConnectionLabel } from "./src/equipmentConnection";
import {
  equipmentWithRequestedControlMode,
  applyPendingEquipmentControlModes,
} from "./src/equipmentControlModeReconciliation";
import {
  getDashboardData,
  createCloudAquarium,
  listDashboardAquariums,
  listArchivedDashboardAquariums,
  archiveDashboardAquarium,
  restoreDashboardAquarium,
  analyzeDashboardReefCoach,
  loadSharedWaterAlarmRules,
  saveSharedWaterAlarmRules,
  selectDashboardAquarium,
  CloudAquariumRequiredError,
  removeDashboardController,
  renameCloudEdge,
  requestDashboardControllerUpdate,
  setDashboardControllerReleaseChannel,
  reprovisionCloudEdge,
  createCloudLocalAuthorization,
  setDashboardEquipmentControlMode,
  setDashboardEquipmentProgramType,
  updateDashboardAquariumName,
  updateDashboardEquipment,
  updateDashboardEquipmentLayout,
  setDashboardWaterProbeCalibration,
  renameDashboardManagedDevice,
  deleteDashboardManagedDevice,
  cloneDashboardEquipmentConfiguration,
  swapDashboardEquipmentBindings,
} from "./src/dashboardConnection";
import {
  equipmentRoleLabel,
  programTypeForEquipmentRole,
} from "./src/equipmentRoleProgram";
import {
  authorizeLocalEdgeFromCloud,
  claimLocalEdge,
  configureEdgeTarget,
  initializeLocalAuthorization,
  probeEdgeTarget,
} from "./src/edgeClient";
import {
  currentEdgeTarget,
  localUrlForHostname,
  restoreEdgeTarget,
} from "./src/edgeTarget";
import { OnboardingPanel } from "./src/OnboardingPanel";
import { ManagedDevicesPanel } from "./src/ManagedDevicesPanel";
import { CircularActionButton } from "./src/CircularActionButton";
import { FeedModePanel } from "./src/FeedModePanel";
import { feedCycleTargetControllerIds } from "./src/feedModeReconciliation";
import {
  AquariumLogPanel,
  type NoteEntryRequest,
  type TestEntryRequest,
} from "./src/AquariumLogPanel";
import { WaterTestsScreen } from "./src/WaterTestsScreen";
import { FlaskIcon, GraphIcon } from "./src/MeasurementIcons";
import {
  AlertsDiagnosticsPanel,
  loadAlertPreferences,
  reconcileAlertLifecycle,
  saveAlertRules,
} from "./src/AlertsDiagnosticsPanel";
import { WaterQualityDetailPanel } from "./src/WaterQualityDetailPanel";
import { ReefCoachPanel } from "./src/ReefCoachPanel";
import { ScheduleTasksPanel } from "./src/ScheduleTasksPanel";
import { RoutinesPanel } from "./src/RoutinesPanel";
import { groupCloudEquipmentInventory } from "./src/cloudEquipmentInventory";
import {
  acknowledgedAlertsFromEvents,
  alertReadingsFromMeasurements,
  defaultAlertRules,
  getDiagnosticIssues,
  requirePersistentWaterIssues,
  type AlertRules,
  type AlertMetric,
  type EdgeAvailability,
} from "./src/diagnostics";

const quickTestParameters: Array<{
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

const equipmentControlModes: EquipmentControlMode[] = [
  "off",
  "auto",
  "on",
];

const equipmentRoleChoices: EquipmentRole[] = [
  "outlet",
  "doser",
  "return-pump",
  "circulation-pump",
  "skimmer",
  "heater",
  "light",
  "ato",
  "uv",
  "sensor",
  "other",
];

interface EquipmentDisplayPreferences {
  order: string[];
  hidden: string[];
}

const equipmentDisplayPreferencesKey =
  "modreef.equipment-display-preferences";

type OutletTransferAction = "clone" | "swap";

function outletCompatibilityClass(equipment: Equipment): string | undefined {
  const connection = equipment.physicalConnectionId;
  if (!connection) return undefined;
  return connection.toLowerCase().startsWith("usb") ? "usb" : "outlet";
}

function controllerDisplayName(controller: EdgeSummary): string {
  const configured = controller.name.trim();
  if (configured && configured.toLowerCase() !== "reef controller") return configured;

  const hostname = controller.localHostname
    ?.trim()
    .replace(/\.local$/i, "");
  if (hostname) return hostname;

  return `Reef Controller ${controller.id.slice(0, 8)}`;
}

export default function App() {
  const webLocation = globalThis as typeof globalThis & {
    location?: { pathname?: string };
  };
  if (
    Platform.OS === "web" &&
    isCommunityDownloadPath(webLocation.location?.pathname ?? "")
  ) {
    return <CommunityControllerDownload />;
  }

  if (dashboardConnectionMode() === "cloud") {
    return (
      <CloudAuthGate>
        <Dashboard />
      </CloudAuthGate>
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const cloudMode = dashboardConnectionMode() === "cloud";
  const cloudAuth = useCloudAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [biometricSettingBusy, setBiometricSettingBusy] = useState(false);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const isWideLayout =
    Platform.OS === "web" ? width >= 1200 : isTablet;
  const isDesktopWeb = Platform.OS === "web" && width >= 1200;

  const [twin, setTwin] = useState<AquariumDigitalTwin>(() => ({
    ...demoTwin,
    equipment: [],
    measurements: [],
    recommendations: [],
  }));
  const [dashboardDataLoaded, setDashboardDataLoaded] = useState(false);
  const [controllerNames, setControllerNames] = useState<Record<string, string>>({});
  const [deviceControllerIds, setDeviceControllerIds] = useState<Record<string, string>>({});
  const [controllerIds, setControllerIds] = useState<Record<string, string>>({});
  const [reefControllers, setReefControllers] = useState<EdgeSummary[]>([]);
  const feedControllerIds = useMemo(
    () => cloudMode
      ? feedCycleTargetControllerIds(twin.equipment, controllerIds)
      : ["local"],
    [cloudMode, controllerIds, twin.equipment],
  );
  const [controllerActionMenuId, setControllerActionMenuId] =
    useState<string | null>(null);
  const [editingControllerId, setEditingControllerId] = useState<string | null>(null);
  const [controllerName, setControllerName] = useState("");
  const [savingControllerId, setSavingControllerId] = useState<string | null>(null);
  const [controllerNameError, setControllerNameError] = useState<string | null>(null);
  const [selectedLocalControllerId, setSelectedLocalControllerId] =
    useState<string | null>(null);
  const automaticControllerSelectionAttempt = useRef<string | null>(null);
  const [localControllerBusyId, setLocalControllerBusyId] =
    useState<string | null>(null);
  const [localControllerError, setLocalControllerError] =
    useState<string | null>(null);
  const [removingControllerId, setRemovingControllerId] = useState<string | null>(null);
  const [controllerRemovalError, setControllerRemovalError] = useState<string | null>(null);
  const [controllerUpdateBusyId, setControllerUpdateBusyId] = useState<string | null>(null);
  const [controllerUpdateError, setControllerUpdateError] = useState<string | null>(null);
  const [editingCloudDeviceKey, setEditingCloudDeviceKey] = useState<string | null>(null);
  const [cloudDeviceName, setCloudDeviceName] = useState("");
  const [cloudDeviceBusyKey, setCloudDeviceBusyKey] = useState<string | null>(null);
  const [cloudDeviceError, setCloudDeviceError] = useState<string | null>(null);
  const [expandedCloudDeviceKeys, setExpandedCloudDeviceKeys] =
    useState<Set<string>>(() => new Set());
  const [cloudDevicesExpanded, setCloudDevicesExpanded] = useState(false);
  const [aquariumsExpanded, setAquariumsExpanded] = useState(false);
  const [aquariumSelectorOpen, setAquariumSelectorOpen] = useState(false);
  const [accountAquariums, setAccountAquariums] = useState<AquariumSummary[]>([]);
  const [archivedAquariums, setArchivedAquariums] = useState<AquariumSummary[]>([]);
  const [newAquariumName, setNewAquariumName] = useState("");
  const [addingAquarium, setAddingAquarium] = useState(false);
  const [aquariumListError, setAquariumListError] = useState<string | null>(null);
  const [aquariumLifecycleBusyId, setAquariumLifecycleBusyId] = useState<string | null>(null);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [aquariumSettingsOpen, setAquariumSettingsOpen] =
    useState(false);
  const [waterTestsOpen, setWaterTestsOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [reefCoachOpen, setReefCoachOpen] = useState(false);
  const [reefCoachAnalysis, setReefCoachAnalysis] = useState<ReefCoachReport | null>(null);
  const [reefCoachAnalyzing, setReefCoachAnalyzing] = useState(false);
  const [reefCoachAnalysisError, setReefCoachAnalysisError] = useState<string | null>(null);
  const [selectedWaterMetric, setSelectedWaterMetric] = useState<AlertMetric | null>(null);
  const [waterQualitySensor, setWaterQualitySensor] = useState<Equipment | null>(null);
  const pendingWaterIssues = useRef<Record<string, number>>({});
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const [edgeAvailability, setEdgeAvailability] =
    useState<EdgeAvailability>("unknown");
  const [acknowledgedAlerts, setAcknowledgedAlerts] =
    useState<Record<string, string>>({});
  const [sharedAcknowledgedAlerts, setSharedAcknowledgedAlerts] =
    useState<Record<string, string>>({});
  const [sharedAlertEvents, setSharedAlertEvents] = useState<AquariumEvent[]>([]);
  const [sharedAlertEventsLoaded, setSharedAlertEventsLoaded] = useState(false);
  const [alertPreferencesLoaded, setAlertPreferencesLoaded] = useState(false);
  const [alertStateVersion, setAlertStateVersion] = useState(0);
  const [alertRules, setAlertRules] =
    useState<AlertRules>(defaultAlertRules);
  const waterAlarmSavePending = useRef(false);
  const reefCoachReport = useMemo(() => buildReefCoachReport({
    aquarium: twin.aquarium,
    equipment: [
      ...twin.equipment,
      ...(waterQualitySensor ? [waterQualitySensor] : []),
    ],
    events: sharedAlertEvents,
  }), [sharedAlertEvents, twin.aquarium, twin.equipment, waterQualitySensor]);
  const analyzeReefCoach = useCallback(async () => {
    if (!cloudMode || reefCoachAnalyzing) return;
    setReefCoachAnalyzing(true);
    setReefCoachAnalysisError(null);
    try {
      setReefCoachAnalysis(await analyzeDashboardReefCoach());
    } catch (error) {
      setReefCoachAnalysisError(error instanceof Error ? error.message : "Reef Coach analysis is unavailable.");
    } finally {
      setReefCoachAnalyzing(false);
    }
  }, [cloudMode, reefCoachAnalyzing]);
  useEffect(() => {
    setReefCoachAnalysis(null);
    setReefCoachAnalysisError(null);
  }, [twin.aquarium.id]);
  const [testEntryRequest, setTestEntryRequest] =
    useState<TestEntryRequest | null>(null);
  const [noteEntryRequest, setNoteEntryRequest] =
    useState<NoteEntryRequest | null>(null);
  const [waterTestsRefreshVersion, setWaterTestsRefreshVersion] =
    useState(0);
  const [aquariumName, setAquariumName] = useState(
    demoTwin.aquarium.name,
  );
  const [editingAquariumName, setEditingAquariumName] = useState(false);
  const editingAquariumNameRef = useRef(false);
  const [savingAquarium, setSavingAquarium] = useState(false);
  const [aquariumError, setAquariumError] =
    useState<string | null>(null);

  const refreshAquariumList = useCallback(async () => {
    if (!cloudMode) return;
    try {
      const [active, archived] = await Promise.all([
        listDashboardAquariums(),
        listArchivedDashboardAquariums(),
      ]);
      setAccountAquariums(active);
      setArchivedAquariums(archived);
      setAquariumListError(null);
    } catch (error) {
      setAquariumListError(
        error instanceof Error ? error.message : "Could not load aquariums.",
      );
    }
  }, [cloudMode]);

  useEffect(() => {
    void refreshAquariumList();
  }, [refreshAquariumList]);
  const [selectedEquipmentId, setSelectedEquipmentId] =
    useState<string | null>(null);
  const [equipmentDetailScrollEnabled, setEquipmentDetailScrollEnabled] =
    useState(true);
  const handleTimelineGestureActive = useCallback((active: boolean) => {
    setEquipmentDetailScrollEnabled(!active);
  }, []);
  const [controllingEquipmentId, setControllingEquipmentId] =
    useState<string | null>(null);
  const [equipmentControlModeOverrides, setEquipmentControlModeOverrides] =
    useState<Record<string, EquipmentControlMode>>({});
  const dashboardRefreshInFlight = useRef(false);
  const dashboardRefreshQueued = useRef(false);
  const pendingEquipmentControlModes = useRef(
    new Map<string, EquipmentControlMode>(),
  );
  const queuedEquipmentControlModes = useRef(
    new Map<string, EquipmentControlMode>(),
  );
  const controlModeReconciliationTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const postPairingRefreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [equipmentError, setEquipmentError] =
    useState<string | null>(null);
  const [editingEquipmentId, setEditingEquipmentId] =
    useState<string | null>(null);
  const [equipmentRole, setEquipmentRole] = useState<EquipmentRole>("outlet");
  const [equipmentName, setEquipmentName] = useState("");
  const [savingEquipment, setSavingEquipment] = useState(false);
  const [equipmentLayoutUnlocked, setEquipmentLayoutUnlocked] =
    useState(false);
  const [draggingEquipmentId, setDraggingEquipmentId] =
    useState<string | null>(null);
  const equipmentDrag = useRef<{
    equipmentId: string;
    startIndex: number;
    startPageY: number;
    visibleOrder: string[];
    preferences: EquipmentDisplayPreferences;
  } | null>(null);
  const [equipmentPreferences, setEquipmentPreferences] =
    useState<EquipmentDisplayPreferences>({
      order: [],
      hidden: [],
    });
  const pendingEquipmentLayout = useRef<EquipmentDisplayPreferences | null>(null);
  const equipmentLayoutSaveInFlight = useRef(false);
  const [cloudSetupRequired, setCloudSetupRequired] = useState(false);
  const [cloudEdgeSetupRequired, setCloudEdgeSetupRequired] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(cloudMode);
  const [cloudLoadError, setCloudLoadError] = useState<string | null>(null);
  const [dashboardRefreshVersion, setDashboardRefreshVersion] = useState(0);
  const [managedDevicesRefreshVersion, setManagedDevicesRefreshVersion] =
    useState(0);
  const [outletTransferAction, setOutletTransferAction] =
    useState<OutletTransferAction | null>(null);
  const [outletTransferTargetId, setOutletTransferTargetId] = useState("");
  const [clonedEquipmentName, setClonedEquipmentName] = useState("");
  const [outletTransferBusy, setOutletTransferBusy] = useState(false);
  const [outletTransferError, setOutletTransferError] =
    useState<string | null>(null);

  useEffect(() => {
    if (!cloudMode || Platform.OS === "web") return;
    let cancelled = false;
    void restoreEdgeTarget().then((target) => {
      if (!cancelled) setSelectedLocalControllerId(target?.edgeId ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [cloudMode]);

  const selectLocalController = useCallback(async (controller: EdgeSummary) => {
    const localAddress = controller.localAddress ?? controller.localHostname;
    if (!localAddress) {
      setLocalControllerError(
        `${controller.name} has not reported its local network address yet. Update and restart that Reef Controller.`,
      );
      return false;
    }
    setLocalControllerBusyId(controller.id);
    setLocalControllerError(null);
    try {
      const target = {
        edgeId: controller.id,
        name: controller.name,
        url: localUrlForHostname(localAddress),
      };
      await probeEdgeTarget(target);
      await configureEdgeTarget(target);
      if (!(await initializeLocalAuthorization())) {
        const authorization = await createCloudLocalAuthorization(controller.id);
        await authorizeLocalEdgeFromCloud(target.url, authorization.grant);
      }
      setSelectedLocalControllerId(controller.id);
      setManagedDevicesRefreshVersion((current) => current + 1);
      return true;
    } catch (error) {
      setSelectedLocalControllerId(null);
      setLocalControllerError(
        error instanceof Error
          ? error.message
          : `Could not reach ${controller.name} on this network.`,
      );
      return false;
    } finally {
      setLocalControllerBusyId(null);
    }
  }, []);

  useEffect(() => {
    if (!cloudMode || Platform.OS === "web") return;
    const selectedController = selectedLocalControllerId
      ? reefControllers.find(({ id }) => id === selectedLocalControllerId)
      : undefined;
    const controller = selectedController ??
      soleControllerForDeviceAdministration(reefControllers, null);
    const localAddress = controller?.localAddress ?? controller?.localHostname;
    if (!controller || !localAddress) return;
    const expectedUrl = localUrlForHostname(localAddress);
    const currentTarget = currentEdgeTarget();
    if (
      currentTarget?.edgeId === controller.id &&
      currentTarget.url === expectedUrl
    ) {
      if (selectedLocalControllerId !== controller.id) {
        setSelectedLocalControllerId(controller.id);
        setManagedDevicesRefreshVersion((current) => current + 1);
      }
      return;
    }
    const attemptKey = `${controller.id}:${expectedUrl}`;
    if (automaticControllerSelectionAttempt.current === attemptKey) return;

    automaticControllerSelectionAttempt.current = attemptKey;
    void selectLocalController(controller);
  }, [cloudMode, reefControllers, selectLocalController, selectedLocalControllerId]);

  const confirmReprovisionController = useCallback((controller: EdgeSummary) => {
    Alert.alert(
      `Reprovision ${controller.name}?`,
      "Use this only after resetting or replacing this Reef Controller. Its previous cloud credential will stop working.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reprovision",
          style: "destructive",
          onPress: () => void (async () => {
            if (!controller.localHostname) {
              setLocalControllerError("This controller has not reported its local network name.");
              return;
            }
            setLocalControllerBusyId(controller.id);
            setLocalControllerError(null);
            try {
              const credentials = await reprovisionCloudEdge(controller.id);
              const url = localUrlForHostname(controller.localAddress ?? controller.localHostname);
              await configureEdgeTarget({ edgeId: controller.id, name: controller.name, url });
              await claimLocalEdge(url, credentials);
              setSelectedLocalControllerId(controller.id);
              setDashboardRefreshVersion((current) => current + 1);
            } catch (error) {
              setLocalControllerError(
                error instanceof Error ? error.message : "Could not reprovision the Reef Controller.",
              );
            } finally {
              setLocalControllerBusyId(null);
            }
          })(),
        },
      ],
    );
  }, []);

  const confirmRemoveController = useCallback((controller: EdgeSummary) => {
    const message =
      "Remove every device from this Reef Controller first. Removal then unassigns the empty physical controller, retires its cloud record, and retains aquarium history.";
    const remove = async () => {
      try {
        setRemovingControllerId(controller.id);
        setControllerRemovalError(null);
        await removeDashboardController(controller);
        setReefControllers((current) =>
          current.filter((item) => item.id !== controller.id),
        );
        if (selectedLocalControllerId === controller.id) {
          setSelectedLocalControllerId(null);
        }
        setDashboardRefreshVersion((current) => current + 1);
      } catch (error) {
        setControllerRemovalError(
          error instanceof Error
            ? error.message
            : "Could not remove the Reef Controller.",
        );
      } finally {
        setRemovingControllerId(null);
      }
    };

    if (Platform.OS === "web") {
      if (globalThis.confirm(`Remove ${controller.name}?\n\n${message}`)) {
        void remove();
      }
      return;
    }
    Alert.alert(`Remove ${controller.name}?`, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove() },
    ]);
  }, [selectedLocalControllerId]);

  const saveControllerName = useCallback(async (controllerId: string) => {
    const name = controllerName.trim();
    if (!name) return;
    setSavingControllerId(controllerId);
    setControllerNameError(null);
    try {
      const updated = await renameCloudEdge(controllerId, name);
      setReefControllers((current) =>
        current.map((controller) => controller.id === controllerId ? updated : controller),
      );
      setControllerNames((current) => Object.fromEntries(
        Object.entries(current).map(([equipmentId, currentName]) => [
          equipmentId,
          controllerIds[equipmentId] === controllerId ? updated.name : currentName,
        ]),
      ));
      setEditingControllerId(null);
      setControllerName("");
    } catch (error) {
      setControllerNameError(
        error instanceof Error ? error.message : "Could not rename the Reef Controller.",
      );
    } finally {
      setSavingControllerId(null);
    }
  }, [controllerIds, controllerName]);

  const checkControllerForUpdates = useCallback(async (controller: EdgeSummary) => {
    setControllerUpdateBusyId(controller.id);
    setControllerUpdateError(null);
    setReefControllers((current) => current.map((item) => item.id === controller.id
      ? {
          ...item,
          runtimeState: {
            ...item.runtimeState,
            controllerUpdate: {
              status: "requested",
              ...(item.runtimeState.controllerUpdate?.installedRelease
                ? { installedRelease: item.runtimeState.controllerUpdate.installedRelease }
                : {}),
              message: "Update check requested",
              automaticUpdatesEnabled: true,
            },
          },
        }
      : item));
    try {
      await requestDashboardControllerUpdate(controller.id);
      setDashboardRefreshVersion((current) => current + 1);
    } catch (error) {
      setControllerUpdateError(
        error instanceof Error ? error.message : "Could not request a controller update check.",
      );
    } finally {
      setControllerUpdateBusyId(null);
    }
  }, []);

  const changeControllerReleaseChannel = useCallback(async (
    controller: EdgeSummary,
    channel: "production" | "staging",
  ) => {
    const currentChannel = controller.runtimeState.controllerUpdate?.releaseChannel ?? "production";
    if (currentChannel === channel) return;
    setControllerUpdateBusyId(controller.id);
    setControllerUpdateError(null);
    try {
      await setDashboardControllerReleaseChannel(controller.id, channel);
      setReefControllers((current) => current.map((item) => item.id === controller.id
        ? {
            ...item,
            runtimeState: {
              ...item.runtimeState,
              controllerUpdate: {
                ...(item.runtimeState.controllerUpdate ?? { automaticUpdatesEnabled: true }),
                status: "requested",
                releaseChannel: channel,
                message: "Update check requested",
              },
            },
          }
        : item));
      setDashboardRefreshVersion((current) => current + 1);
    } catch (error) {
      setControllerUpdateError(
        error instanceof Error ? error.message : "Could not change the controller release channel.",
      );
    } finally {
      setControllerUpdateBusyId(null);
    }
  }, []);

  const saveCloudDeviceName = useCallback(async (
    key: string,
    controllerId: string | undefined,
    deviceId: string | undefined,
  ) => {
    const name = cloudDeviceName.trim();
    if (!controllerId || !deviceId || !name) return;
    setCloudDeviceBusyKey(key);
    setCloudDeviceError(null);
    try {
      await renameDashboardManagedDevice(controllerId, deviceId, name);
      setEditingCloudDeviceKey(null);
      setCloudDeviceName("");
      setDashboardRefreshVersion((current) => current + 1);
    } catch (error) {
      setCloudDeviceError(error instanceof Error ? error.message : "Could not rename the device.");
    } finally {
      setCloudDeviceBusyKey(null);
    }
  }, [cloudDeviceName]);

  const confirmDeleteCloudDevice = useCallback((group: {
    key: string;
    controllerId?: string;
    deviceId?: string;
    deviceName: string;
    controllerName: string;
  }) => {
    const message =
      `This removes ${group.deviceName}, all of its equipment channels, assignments, and schedules from ${group.controllerName}. The physical device will not be factory-reset.`;
    const remove = async () => {
      if (!group.controllerId || !group.deviceId) return;
      setCloudDeviceBusyKey(group.key);
      setCloudDeviceError(null);
      try {
        await deleteDashboardManagedDevice(group.controllerId, group.deviceId);
        setDashboardRefreshVersion((current) => current + 1);
      } catch (error) {
        setCloudDeviceError(error instanceof Error ? error.message : "Could not delete the device.");
      } finally {
        setCloudDeviceBusyKey(null);
      }
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm(`Delete ${group.deviceName}?\n\n${message}`)) void remove();
      return;
    }
    Alert.alert(`Delete ${group.deviceName}?`, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Device", style: "destructive", onPress: () => void remove() },
    ]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreEquipmentPreferences() {
      try {
        if (!(await SecureStore.isAvailableAsync())) {
          return;
        }

        const stored = await SecureStore.getItemAsync(
          equipmentDisplayPreferencesKey,
        );

        if (!stored || cancelled) {
          return;
        }

        const parsed: unknown = JSON.parse(stored);

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray(
            (parsed as EquipmentDisplayPreferences).order,
          ) &&
          Array.isArray(
            (parsed as EquipmentDisplayPreferences).hidden,
          )
        ) {
          const preferences =
            parsed as EquipmentDisplayPreferences;

          setEquipmentPreferences({
            order: [
              ...new Set(
                preferences.order.filter(
                  (value): value is string =>
                    typeof value === "string",
                ),
              ),
            ],
            hidden: [
              ...new Set(
                preferences.hidden.filter(
                  (value): value is string =>
                    typeof value === "string",
                ),
              ),
            ],
          });
        }
      } catch {
        // Invalid or unavailable preferences fall back to outlet order.
      }
    }

    void restoreEquipmentPreferences();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshEquipment = useCallback(async () => {
      if (dashboardRefreshInFlight.current) {
        dashboardRefreshQueued.current = true;
        return;
      }
      dashboardRefreshInFlight.current = true;
      try {
        const {
          equipment,
          aquarium,
          controllerNames: refreshedControllerNames,
          controllerIds: refreshedControllerIds,
          controllers,
          devices,
          deviceControllerIds: refreshedDeviceControllerIds,
          edgeOnline,
          measurements,
          events,
          waterQualitySensor: refreshedWaterQualitySensor,
        } =
          await getDashboardData();

        const reconciledEquipment = applyPendingEquipmentControlModes(
          equipment,
          pendingEquipmentControlModes.current,
        );
        setTwin((current) => ({
          ...current,
          aquarium,
          devices,
          equipment: reconciledEquipment,
          measurements,
        }));
        setDashboardDataLoaded(true);
        setWaterQualitySensor(refreshedWaterQualitySensor ?? null);
        setSharedAcknowledgedAlerts(acknowledgedAlertsFromEvents(events));
        setSharedAlertEvents(events);
        setSharedAlertEventsLoaded(true);
        // Dashboard polling must not overwrite the user's in-progress draft.
        // The same component powers native and web, so this keeps both editors
        // stable while still accepting refreshed names when editing is closed.
        if (!editingAquariumNameRef.current) {
          setAquariumName(aquarium.name);
        }
        setControllerNames(refreshedControllerNames);
        setControllerIds(refreshedControllerIds);
        setDeviceControllerIds(refreshedDeviceControllerIds);
        setReefControllers(controllers);
        if (!equipmentLayoutSaveInFlight.current && !pendingEquipmentLayout.current &&
            equipment.some((item) => item.displayOrder !== undefined)) {
          setEquipmentPreferences({
            order: [...equipment]
              .sort((left, right) =>
                (left.displayOrder ?? Number.MAX_SAFE_INTEGER) -
                (right.displayOrder ?? Number.MAX_SAFE_INTEGER),
              )
              .map((item) => item.id),
            hidden: equipment
              .filter((item) => item.hiddenFromDashboard)
              .map((item) => item.id),
          });
        }
        setEquipmentError(null);
        setCloudLoadError(null);
        setCloudLoading(false);
        setCloudSetupRequired(false);
        // An empty aquarium is a valid, navigable state. Controller setup opens
        // only when the user explicitly chooses Add Reef Controller.
        setCloudEdgeSetupRequired((current) => current);
        setEdgeAvailability(edgeOnline ? "online" : "offline");
      } catch (error) {
        if (error instanceof CloudAquariumRequiredError) {
          setCloudSetupRequired(true);
          setCloudLoadError(null);
        } else if (
          cloudMode &&
          cloudAuth &&
          error instanceof ModReefHttpError &&
          error.status === 401
        ) {
          setCloudLoadError(null);
          await cloudAuth.signOut();
        } else if (cloudMode) {
          setCloudLoadError(
            error instanceof Error
              ? error.message
              : "Could not load the cloud dashboard.",
          );
        } else {
          setEquipmentError(
            error instanceof Error
              ? error.message
              : "Could not load the Reef Controller dashboard.",
          );
        }
        setCloudLoading(false);
        setEdgeAvailability("offline");
      } finally {
        dashboardRefreshInFlight.current = false;
        if (dashboardRefreshQueued.current) {
          dashboardRefreshQueued.current = false;
          setDashboardRefreshVersion((current) => current + 1);
        }
      }
  }, [cloudAuth, cloudMode]);

  useEffect(() => {

    void refreshEquipment();
    const timer = setInterval(
      () => void refreshEquipment(),
      2_000,
    );

    return () => {
      clearInterval(timer);
    };
  }, [refreshEquipment]);

  useEffect(() => {
    if (dashboardRefreshVersion > 0) void refreshEquipment();
  }, [dashboardRefreshVersion, refreshEquipment]);

  useEffect(() => () => {
    postPairingRefreshTimers.current.forEach(clearTimeout);
    controlModeReconciliationTimers.current.forEach(clearTimeout);
  }, []);

  function refreshAfterDeviceConnected() {
    postPairingRefreshTimers.current.forEach(clearTimeout);
    postPairingRefreshTimers.current = [];
    setManagedDevicesRefreshVersion((current) => current + 1);
    setDashboardRefreshVersion((current) => current + 1);

    // Local registration completes before the controller's next cloud-sync
    // pass. Retry the dashboard refresh across that handoff so the new
    // channels appear without requiring an application reload.
    for (const delay of [1_000, 3_000, 7_000]) {
      postPairingRefreshTimers.current.push(setTimeout(() => {
        setDashboardRefreshVersion((current) => current + 1);
      }, delay));
    }
  }

  const alertReadings = useMemo(
    () => alertReadingsFromMeasurements(twin.measurements),
    [twin.measurements],
  );
  const diagnosticIssues = useMemo(() => {
    const evaluated = requirePersistentWaterIssues(
      getDiagnosticIssues(
        twin.equipment,
        edgeAvailability,
        alertRules,
        alertReadings,
      ),
      pendingWaterIssues.current,
    );
    pendingWaterIssues.current = evaluated.pendingSince;
    return evaluated.issues;
  }, [alertReadings, alertRules, edgeAvailability, twin.equipment]);
  const unacknowledgedAlerts = diagnosticIssues.filter(
    (issue) =>
      !acknowledgedAlerts[issue.id] && !sharedAcknowledgedAlerts[issue.id],
  ).length;

  useEffect(() => {
    if (!dashboardDataLoaded) {
      setAlertPreferencesLoaded(false);
      return;
    }
    let cancelled = false;
    setAlertPreferencesLoaded(false);

    void loadAlertPreferences(twin.aquarium.id)
      .then(async (preferences) => ({
        ...preferences,
        rules: await loadSharedWaterAlarmRules(twin.aquarium.id, preferences.rules),
      }))
      .then(async (preferences) => {
        if (cancelled) return;
        await saveAlertRules(twin.aquarium.id, preferences.rules);
        if (cancelled) return;
        setAcknowledgedAlerts(preferences.acknowledged);
        setAlertRules(preferences.rules);
        setAlertPreferencesLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setAcknowledgedAlerts({});
          setAlertPreferencesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dashboardDataLoaded, twin.aquarium.id]);

  useEffect(() => {
    if (!cloudMode || !alertPreferencesLoaded) return;
    let cancelled = false;
    const refresh = () => {
      if (waterAlarmSavePending.current) return;
      void loadSharedWaterAlarmRules(twin.aquarium.id, alertRules)
        .then(async (rules) => {
          if (cancelled) return;
          await saveAlertRules(twin.aquarium.id, rules);
          if (cancelled) return;
          setAlertRules(rules);
        })
        .catch(() => {
          // The locally cached rules remain active while cloud access is interrupted.
        });
    };
    const timer = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [alertPreferencesLoaded, cloudMode, twin.aquarium.id]);

  const saveWaterAlarmRules = useCallback(async (rules: AlertRules) => {
    setAlertRules(rules);
    await saveAlertRules(twin.aquarium.id, rules);
    waterAlarmSavePending.current = true;
    try {
      const confirmed = await saveSharedWaterAlarmRules(twin.aquarium.id, rules);
      setAlertRules(confirmed);
      await saveAlertRules(twin.aquarium.id, confirmed);
    } finally {
      waterAlarmSavePending.current = false;
    }
  }, [twin.aquarium.id]);

  useEffect(() => {
    if (!alertPreferencesLoaded || !sharedAlertEventsLoaded) return;
    let cancelled = false;

    void reconcileAlertLifecycle(
      twin.aquarium.id,
      diagnosticIssues,
      sharedAlertEvents,
    )
      .then((result) => {
        if (cancelled) return;
        setAcknowledgedAlerts(result.acknowledged);
        if (result.changed) setAlertStateVersion((current) => current + 1);
      })
      .catch(() => {
        // Live diagnostics remain visible even if local history cannot persist.
      });

    return () => {
      cancelled = true;
    };
  }, [
    alertPreferencesLoaded,
    diagnosticIssues,
    sharedAlertEvents,
    sharedAlertEventsLoaded,
    twin.aquarium.id,
  ]);

  const selectedEquipment = selectedEquipmentId
    ? getEquipmentById(twin, selectedEquipmentId)
    : undefined;
  const cloudEquipmentInventory = useMemo(
    () => groupCloudEquipmentInventory(
      [
        ...twin.equipment,
        ...(waterQualitySensor && !twin.equipment.some(({ id }) => id === waterQualitySensor.id)
          ? [waterQualitySensor]
          : []),
      ],
      controllerNames,
      controllerIds,
      twin.devices ?? [],
      deviceControllerIds,
      Object.fromEntries(reefControllers.map((edge) => [edge.id, edge.name])),
    ),
    [controllerIds, controllerNames, deviceControllerIds, reefControllers, twin.devices, twin.equipment, waterQualitySensor],
  );
  const selectedPhysicalConnectionId =
    selectedEquipment?.physicalConnectionId ??
    selectedEquipment?.binding?.channelId;
  const compatibleTransferTargets = selectedEquipment
    ? twin.equipment.filter(
        (equipment) =>
          equipment.id !== selectedEquipment.id &&
          (!cloudMode ||
            controllerIds[equipment.id] === controllerIds[selectedEquipment.id]) &&
          outletCompatibilityClass(equipment) ===
            outletCompatibilityClass(selectedEquipment),
      )
    : [];

  function openOutletTransfer(action: OutletTransferAction) {
    setOutletTransferAction(action);
    setOutletTransferTargetId("");
    setClonedEquipmentName("");
    setOutletTransferError(null);
  }

  function closeOutletTransfer() {
    if (outletTransferBusy) return;
    setOutletTransferAction(null);
    setOutletTransferTargetId("");
    setOutletTransferError(null);
  }

  async function completeOutletTransfer() {
    if (!selectedEquipment || !outletTransferTargetId || !outletTransferAction) return;
    setOutletTransferBusy(true);
    setOutletTransferError(null);
    try {
      if (outletTransferAction === "clone") {
        const updated = await cloneDashboardEquipmentConfiguration(
          selectedEquipment.id,
          outletTransferTargetId,
          clonedEquipmentName.trim(),
        );
        setTwin((current) => ({
          ...current,
          equipment: current.equipment.map((item) =>
            item.id === updated.id ? updated : item,
          ),
        }));
      } else {
        const updated = await swapDashboardEquipmentBindings(
          selectedEquipment.id,
          outletTransferTargetId,
        );
        const updates = new Map(updated.map((item) => [item.id, item]));
        setTwin((current) => ({
          ...current,
          equipment: current.equipment.map((item) => updates.get(item.id) ?? item),
        }));
        setDashboardRefreshVersion((current) => current + 1);
      }
      setOutletTransferAction(null);
      setOutletTransferTargetId("");
      setOutletTransferError(null);
    } catch (error) {
      setOutletTransferError(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setOutletTransferBusy(false);
    }
  }

  async function updateEquipmentControlMode(
    equipmentId: string,
    mode: EquipmentControlMode,
  ) {
    setControllingEquipmentId(equipmentId);
    setEquipmentError(null);
    pendingEquipmentControlModes.current.set(equipmentId, mode);
    setEquipmentControlModeOverrides((current) => ({
      ...current,
      [equipmentId]: mode,
    }));
    setTwin((current) => ({
      ...current,
      equipment: current.equipment.map((equipment) =>
        equipment.id === equipmentId
          ? equipmentWithRequestedControlMode(equipment, mode)
          : equipment,
      ),
    }));

    try {
      const current = twin.equipment.find(
        (equipment) => equipment.id === equipmentId,
      );
      if (!current) {
        throw new Error(`Equipment not found: ${equipmentId}`);
      }
      const updated = await setDashboardEquipmentControlMode(
        current,
        mode,
      );
      const queuedMode = queuedEquipmentControlModes.current.get(equipmentId);
      const displayedMode = queuedMode ?? mode;
      const displayedUpdate = equipmentWithRequestedControlMode(
        updated,
        displayedMode,
      );

      setTwin((current) => ({
        ...current,
        equipment: current.equipment.map((equipment) =>
          equipment.id === displayedUpdate.id ? displayedUpdate : equipment,
        ),
      }));
      if (!queuedMode) {
        const existingTimer = controlModeReconciliationTimers.current.get(equipmentId);
        if (existingTimer) clearTimeout(existingTimer);
        controlModeReconciliationTimers.current.set(equipmentId, setTimeout(() => {
          if (pendingEquipmentControlModes.current.get(equipmentId) === mode) {
            pendingEquipmentControlModes.current.delete(equipmentId);
          }
          setEquipmentControlModeOverrides((current) => {
            if (current[equipmentId] !== mode) return current;
            const { [equipmentId]: _removed, ...remaining } = current;
            return remaining;
          });
          controlModeReconciliationTimers.current.delete(equipmentId);
          setDashboardRefreshVersion((current) => current + 1);
        }, 3_000));
      }
    } catch (error) {
      if (pendingEquipmentControlModes.current.get(equipmentId) === mode) {
        pendingEquipmentControlModes.current.delete(equipmentId);
      }
      setEquipmentControlModeOverrides((current) => {
        if (current[equipmentId] !== mode) return current;
        const { [equipmentId]: _removed, ...remaining } = current;
        return remaining;
      });
      const existingTimer = controlModeReconciliationTimers.current.get(equipmentId);
      if (existingTimer) clearTimeout(existingTimer);
      controlModeReconciliationTimers.current.delete(equipmentId);
      setDashboardRefreshVersion((current) => current + 1);
      setEquipmentError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setControllingEquipmentId(null);
      const queuedMode = queuedEquipmentControlModes.current.get(equipmentId);
      queuedEquipmentControlModes.current.delete(equipmentId);
      if (queuedMode && queuedMode !== mode) {
        void updateEquipmentControlMode(equipmentId, queuedMode);
      }
    }
  }

  function beginEditingEquipment() {
    if (!selectedEquipment) {
      return;
    }

    setEquipmentName(selectedEquipment.name);
    setEquipmentRole(selectedEquipment.role);
    setEditingEquipmentId(selectedEquipment.id);
    setEquipmentError(null);
  }

  function cancelEditingEquipment() {
    setEditingEquipmentId(null);
    setEquipmentName("");
  }

  function closeEquipmentDetail() {
    if (savingEquipment || outletTransferBusy) return;
    cancelEditingEquipment();
    closeOutletTransfer();
    setSelectedEquipmentId(null);
    setEquipmentDetailScrollEnabled(true);
  }

  async function saveEquipmentConfiguration() {
    if (!selectedEquipment || !equipmentName.trim()) {
      return;
    }

    setSavingEquipment(true);
    setEquipmentError(null);

    try {
      let updated = await updateDashboardEquipment(
        selectedEquipment.id,
        equipmentName.trim(),
        selectedEquipment.programTypeLocked
          ? selectedEquipment.role
          : equipmentRole,
      );

      const matchingProgram = programTypeForEquipmentRole(equipmentRole);
      if (
        !selectedEquipment.programTypeLocked &&
        matchingProgram &&
        matchingProgram !== selectedEquipment.programType
      ) {
        updated = await setDashboardEquipmentProgramType(
          selectedEquipment.id,
          matchingProgram,
        );
      }

      setTwin((current) => ({
        ...current,
        equipment: current.equipment.map((equipment) =>
          equipment.id === updated.id ? updated : equipment,
        ),
      }));
      setEditingEquipmentId(null);
      setEquipmentName("");
    } catch (error) {
      setEquipmentError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSavingEquipment(false);
    }
  }

  const controllerOrderedEquipment = [...twin.equipment].sort(
    (left, right) =>
      (left.displayOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.displayOrder ?? Number.MAX_SAFE_INTEGER),
  );
  const equipmentIds = controllerOrderedEquipment.map(
    (equipment) => equipment.id,
  );
  const orderedEquipmentIds = [
    ...equipmentPreferences.order.filter((id) =>
      equipmentIds.includes(id),
    ),
    ...equipmentIds.filter(
      (id) => !equipmentPreferences.order.includes(id),
    ),
  ];
  const orderedEquipment = orderedEquipmentIds.flatMap((id) => {
    const equipment = controllerOrderedEquipment.find(
      (candidate) => candidate.id === id,
    );

    return equipment ? [equipment] : [];
  });
  const hiddenEquipmentIds = new Set(
    equipmentPreferences.hidden.filter((id) =>
      equipmentIds.includes(id),
    ),
  );
  const visibleEquipment = orderedEquipment.filter(
    (equipment) => !hiddenEquipmentIds.has(equipment.id),
  );
  const hiddenEquipment = orderedEquipment.filter((equipment) =>
    hiddenEquipmentIds.has(equipment.id),
  );

  async function saveEquipmentDisplayPreferences(
    preferences: EquipmentDisplayPreferences,
  ) {
    setEquipmentError(null);
    const hidden = new Set(preferences.hidden);
    setEquipmentPreferences(preferences);
    setTwin((current) => ({
      ...current,
      equipment: current.equipment.map((equipment) => {
        const displayOrder = preferences.order.indexOf(equipment.id);
        return displayOrder < 0
          ? equipment
          : {
              ...equipment,
              displayOrder,
              hiddenFromDashboard: hidden.has(equipment.id),
            };
      }),
    }));

    try {
      if (await SecureStore.isAvailableAsync()) {
        await SecureStore.setItemAsync(
          equipmentDisplayPreferencesKey,
          JSON.stringify(preferences),
        );
      }
    } catch {
      // Keep the in-memory layout if local persistence is unavailable.
    }

    pendingEquipmentLayout.current = preferences;
    if (equipmentLayoutSaveInFlight.current) return;
    equipmentLayoutSaveInFlight.current = true;
    try {
      while (pendingEquipmentLayout.current) {
        const next = pendingEquipmentLayout.current;
        pendingEquipmentLayout.current = null;
        const nextHidden = new Set(next.hidden);
        const updated = await updateDashboardEquipmentLayout(
          next.order.map((equipmentId, displayOrder) => ({
            equipmentId,
            displayOrder,
            hiddenFromDashboard: nextHidden.has(equipmentId),
          })),
        );
        if (!pendingEquipmentLayout.current) {
          const byId = new Map(updated.map((item) => [item.id, item]));
          setTwin((current) => ({
            ...current,
            equipment: current.equipment.map((item) => byId.get(item.id) ?? item),
          }));
        }
      }
    } catch (error) {
      setEquipmentError(
        `Saved on this device, but the Reef Controller did not confirm the layout: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      equipmentLayoutSaveInFlight.current = false;
      if (pendingEquipmentLayout.current) {
        void saveEquipmentDisplayPreferences(pendingEquipmentLayout.current);
      }
    }
  }

  function moveEquipment(
    equipmentId: string,
    direction: -1 | 1,
  ) {
    const visibleIds = visibleEquipment.map(
      (equipment) => equipment.id,
    );
    const currentIndex = visibleIds.indexOf(equipmentId);
    const nextIndex = currentIndex + direction;

    if (
      currentIndex < 0 ||
      nextIndex < 0 ||
      nextIndex >= visibleIds.length
    ) {
      return;
    }

    const [movedEquipmentId] = visibleIds.splice(
      currentIndex,
      1,
    );

    if (!movedEquipmentId) {
      return;
    }

    visibleIds.splice(nextIndex, 0, movedEquipmentId);

    void saveEquipmentDisplayPreferences({
      order: [
        ...visibleIds,
        ...hiddenEquipment.map((equipment) => equipment.id),
      ],
      hidden: [...hiddenEquipmentIds],
    });
  }

  function beginEquipmentDrag(equipmentId: string, pageY: number) {
    const visibleOrder = visibleEquipment.map((equipment) => equipment.id);
    const startIndex = visibleOrder.indexOf(equipmentId);
    if (startIndex < 0) return;
    const preferences = {
      order: [...visibleOrder, ...hiddenEquipment.map((equipment) => equipment.id)],
      hidden: [...hiddenEquipmentIds],
    };
    equipmentDrag.current = {
      equipmentId,
      startIndex,
      startPageY: pageY,
      visibleOrder,
      preferences,
    };
    setDraggingEquipmentId(equipmentId);
  }

  function updateEquipmentDrag(pageY: number) {
    const drag = equipmentDrag.current;
    if (!drag) return;
    const rowHeight = isDesktopWeb ? 80 : 68;
    const targetIndex = Math.max(
      0,
      Math.min(
        drag.visibleOrder.length - 1,
        Math.round(drag.startIndex + (pageY - drag.startPageY) / rowHeight),
      ),
    );
    const nextVisibleOrder = drag.visibleOrder.filter(
      (equipmentId) => equipmentId !== drag.equipmentId,
    );
    nextVisibleOrder.splice(targetIndex, 0, drag.equipmentId);
    const preferences = {
      order: [...nextVisibleOrder, ...hiddenEquipment.map((equipment) => equipment.id)],
      hidden: [...hiddenEquipmentIds],
    };
    if (preferences.order.join("|") === drag.preferences.order.join("|")) return;
    drag.preferences = preferences;
    setEquipmentPreferences(preferences);
  }

  function finishEquipmentDrag() {
    const preferences = equipmentDrag.current?.preferences;
    equipmentDrag.current = null;
    setDraggingEquipmentId(null);
    if (preferences) void saveEquipmentDisplayPreferences(preferences);
  }

  function hideEquipment(equipmentId: string) {
    if (selectedEquipmentId === equipmentId) {
      setSelectedEquipmentId(null);
    }

    void saveEquipmentDisplayPreferences({
      order: orderedEquipmentIds,
      hidden: [...new Set([...hiddenEquipmentIds, equipmentId])],
    });
  }

  function showEquipment(equipmentId: string) {
    void saveEquipmentDisplayPreferences({
      order: orderedEquipmentIds,
      hidden: [...hiddenEquipmentIds].filter(
        (id) => id !== equipmentId,
      ),
    });
  }

  function toggleEquipmentLayout() {
    if (equipmentLayoutUnlocked) {
      void saveEquipmentDisplayPreferences({
        order: orderedEquipmentIds,
        hidden: [...hiddenEquipmentIds],
      });
    }

    setEquipmentLayoutUnlocked((current) => !current);
  }

  async function saveAquariumName() {
    const name = aquariumName.trim();

    if (!name) {
      setAquariumError("Enter an aquarium name.");
      return;
    }

    if (name.length > 80) {
      setAquariumError(
        "Aquarium name must be 80 characters or fewer.",
      );
      return;
    }

    setSavingAquarium(true);
    setAquariumError(null);

    try {
      const aquarium = await updateDashboardAquariumName(name);

      setTwin((current) => ({
        ...current,
        aquarium,
      }));
      setAccountAquariums((current) => current.map((summary) =>
        summary.id === aquarium.id ? { ...summary, name: aquarium.name } : summary
      ));
      setAquariumName(aquarium.name);
      editingAquariumNameRef.current = false;
      setEditingAquariumName(false);
    } catch (error) {
      setAquariumError(
        error instanceof Error
          ? error.message
          : "Could not save aquarium name.",
      );
    } finally {
      setSavingAquarium(false);
    }
  }

  async function switchAquarium(aquariumId: string) {
    if (aquariumId === twin.aquarium.id) {
      setAquariumSelectorOpen(false);
      return;
    }
    try {
      setAquariumListError(null);
      await selectDashboardAquarium(aquariumId);
      setAquariumSelectorOpen(false);
      setAquariumSettingsOpen(false);
      editingAquariumNameRef.current = false;
      setEditingAquariumName(false);
      setSelectedLocalControllerId(null);
      setSelectedEquipmentId(null);
      setReefControllers([]);
      setControllerNames({});
      setControllerIds({});
      setCloudLoading(true);
      setCloudEdgeSetupRequired(false);
      setDashboardRefreshVersion((current) => current + 1);
    } catch (error) {
      setAquariumListError(
        error instanceof Error ? error.message : "Could not switch aquariums.",
      );
    }
  }

  async function addAquarium() {
    const name = newAquariumName.trim();
    if (!name) return;
    try {
      setAddingAquarium(true);
      setAquariumListError(null);
      await createCloudAquarium(name);
      setNewAquariumName("");
      await refreshAquariumList();
      setSelectedLocalControllerId(null);
      setSelectedEquipmentId(null);
      setReefControllers([]);
      setControllerNames({});
      setControllerIds({});
      setCloudLoading(true);
      setCloudEdgeSetupRequired(false);
      setDashboardRefreshVersion((current) => current + 1);
    } catch (error) {
      setAquariumListError(
        error instanceof Error ? error.message : "Could not create aquarium.",
      );
    } finally {
      setAddingAquarium(false);
    }
  }

  function confirmArchiveAquarium(aquarium: AquariumSummary) {
    const message = `Archive ${aquarium.name}? It will leave the normal aquarium list but retain its history. Every Reef Controller must be removed first.`;
    const archive = async () => {
      setAquariumLifecycleBusyId(aquarium.id);
      setAquariumListError(null);
      try {
        await archiveDashboardAquarium(aquarium.id);
        await refreshAquariumList();
        setAquariumSettingsOpen(false);
        setSelectedLocalControllerId(null);
        setSelectedEquipmentId(null);
        setCloudLoading(true);
        setDashboardRefreshVersion((current) => current + 1);
      } catch (error) {
        setAquariumListError(error instanceof Error ? error.message : "Could not archive aquarium.");
      } finally {
        setAquariumLifecycleBusyId(null);
      }
    };
    if (Platform.OS === "web") {
      if (globalThis.confirm(message)) void archive();
      return;
    }
    Alert.alert(`Archive ${aquarium.name}?`, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Archive", style: "destructive", onPress: () => void archive() },
    ]);
  }

  async function restoreAquarium(aquarium: AquariumSummary) {
    setAquariumLifecycleBusyId(aquarium.id);
    setAquariumListError(null);
    try {
      await restoreDashboardAquarium(aquarium.id);
      await refreshAquariumList();
    } catch (error) {
      setAquariumListError(error instanceof Error ? error.message : "Could not restore aquarium.");
    } finally {
      setAquariumLifecycleBusyId(null);
    }
  }

  async function closeControllerSetup() {
    setCloudEdgeSetupRequired(false);
  }

  function cancelAquariumNameEdit() {
    setAquariumName(twin.aquarium.name);
    setAquariumError(null);
    editingAquariumNameRef.current = false;
    setEditingAquariumName(false);
  }

  function startTestEntry(parameter: WaterParameter, name?: string) {
    setAquariumSettingsOpen(false);
    setTestEntryRequest({
      parameter,
      ...(name ? { name } : {}),
      nonce: Date.now(),
    });
  }

  if (cloudMode && cloudSetupRequired) {
    return (
      <CloudAquariumSetup
        onCreated={() => {
          setCloudSetupRequired(false);
          setDashboardRefreshVersion((current) => current + 1);
        }}
      />
    );
  }

  if (cloudMode && cloudLoading) {
    return (
      <SafeAreaView
        accessibilityLabel="Loading your aquarium"
        style={styles.cloudStatusScreen}
      >
        <ActivityIndicator color="#20B7EC" size="large" />
      </SafeAreaView>
    );
  }

  if (cloudMode && cloudLoadError) {
    return (
      <SafeAreaView style={styles.cloudStatusScreen}>
        <View style={styles.cloudStatusCard}>
          <Image
            accessibilityLabel="modREEF — Modular, Smart, Connected"
            resizeMode="contain"
            source={require("./assets/brand/modreef-logo.png")}
            style={styles.cloudStatusLogo}
          />
          <Text style={styles.cloudStatusTitle}>Cloud connection interrupted</Text>
          <Text style={styles.cloudStatusCopy}>{cloudLoadError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setCloudLoading(true);
              setCloudLoadError(null);
              setDashboardRefreshVersion((current) => current + 1);
            }}
            style={styles.cloudStatusButton}
          >
            <Text style={styles.cloudStatusButtonText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (cloudMode && cloudEdgeSetupRequired) {
    return (
      <SafeAreaView style={styles.cloudStatusScreen}>
        <CloudEdgeSetup
          onCancel={() => void closeControllerSetup()}
          onConfigured={() => {
            // The controller is already claimed when this callback runs. Keep
            // the current aquarium usable while its new inventory arrives;
            // cloudLoading is reserved for the initial application bootstrap.
            // Turning it back on here can strand the entire app behind a
            // spinner if a dashboard refresh is already in flight.
            setCloudEdgeSetupRequired(false);
            setDashboardRefreshVersion((current) => current + 1);
          }}
        />
      </SafeAreaView>
    );
  }

  if (waterTestsOpen) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" />
        <ScrollView
          contentContainerStyle={[
            styles.screen,
            isTablet ? styles.screenTablet : undefined,
            isDesktopWeb ? styles.screenDesktop : undefined,
          ]}
        >
          <View style={styles.measurementScreenHeader}>
            <View>
              <Text style={styles.eyebrow}>WATER HISTORY</Text>
              <Text style={styles.workspaceScreenTitle}>Measurements</Text>
            </View>
            <WorkspaceCloseButton
              accessibilityLabel="Close Measurements"
              onPress={() => setWaterTestsOpen(false)}
            />
          </View>

          <WaterTestsScreen
            onStartTest={startTestEntry}
            refreshVersion={waterTestsRefreshVersion}
          />
          <AquariumLogPanel
            modalOnly
            onTestEntryClosed={() => setTestEntryRequest(null)}
            onTestSaved={() =>
              setWaterTestsRefreshVersion((current) => current + 1)
            }
            testEntryRequest={testEntryRequest}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        key={isWideLayout ? "dashboard-wide" : "dashboard-stacked"}
        contentContainerStyle={[
          styles.screen,
          isTablet ? styles.screenTablet : undefined,
          isDesktopWeb ? styles.screenDesktop : undefined,
        ]}
        scrollEnabled={draggingEquipmentId === null}
      >
        <View style={[
          styles.contextBanner,
          isDesktopWeb ? styles.contextBannerDesktop : undefined,
        ]}>
          <View
            style={[
              styles.tankSelector,
              isDesktopWeb ? styles.tankSelectorDesktop : undefined,
            ]}
          >
            <Pressable
              accessibilityLabel={accountAquariums.length > 1
                ? `Switch aquarium. Current aquarium: ${twin.aquarium.name}`
                : `Current aquarium: ${twin.aquarium.name}`}
              accessibilityRole={accountAquariums.length > 1 ? "button" : undefined}
              accessibilityState={accountAquariums.length > 1
                ? { expanded: aquariumSelectorOpen }
                : undefined}
              disabled={accountAquariums.length < 2}
              onPress={() => setAquariumSelectorOpen((current) => !current)}
              style={styles.tankSelectorButton}
            >
              <View style={styles.tankSelectorCopy}>
                <Text style={[
                  styles.contextLabel,
                  isDesktopWeb ? styles.contextLabelDesktop : undefined,
                ]}>AQUARIUM</Text>
                <Text numberOfLines={1} style={[
                  styles.contextTankName,
                  isDesktopWeb ? styles.contextTankNameDesktop : undefined,
                ]}>
                  {twin.aquarium.name}
                </Text>
              </View>
              {accountAquariums.length > 1 ? (
                <Text style={styles.contextChevron}>
                  {aquariumSelectorOpen ? "▾" : "▸"}
                </Text>
              ) : null}
            </Pressable>
            {aquariumSelectorOpen ? (
              <View style={styles.aquariumSelectorMenu}>
                {accountAquariums.map((aquarium) => (
                  <Pressable
                    accessibilityRole="button"
                    key={aquarium.id}
                    onPress={() => void switchAquarium(aquarium.id)}
                    style={[
                      styles.aquariumSelectorItem,
                      aquarium.id === twin.aquarium.id
                        ? styles.aquariumSelectorItemActive
                        : undefined,
                    ]}
                  >
                    <Text style={styles.aquariumSelectorItemText} numberOfLines={1}>
                      {aquarium.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <Image
            accessibilityLabel="modREEF"
            resizeMode="contain"
            source={require("./assets/brand/modreef-wordmark-transparent.png")}
            style={[
              styles.contextBrandLogo,
              isDesktopWeb ? styles.contextBrandLogoDesktop : undefined,
            ]}
          />

          <View style={styles.contextBannerActions}>
            <Pressable
              accessibilityLabel={
                unacknowledgedAlerts === 0
                  ? "No active alerts"
                  : `Open ${unacknowledgedAlerts} active alerts`
              }
              accessibilityRole="button"
              onPress={() => setAlertsOpen(true)}
              style={({ pressed }) => [
                styles.contextAlertControl,
                isDesktopWeb ? styles.contextAlertControlDesktop : undefined,
                unacknowledgedAlerts > 0
                  ? styles.contextAlertControlActive
                  : undefined,
                pressed ? styles.contextAlertControlPressed : undefined,
              ]}
            >
              <AlertIcon active={unacknowledgedAlerts > 0} />
              <Text
                style={[
                  styles.contextAlertText,
                  isDesktopWeb ? styles.contextAlertTextDesktop : undefined,
                  unacknowledgedAlerts > 0
                    ? styles.contextAlertTextActive
                    : undefined,
                ]}
              >
                {unacknowledgedAlerts === 0
                  ? "ALL CLEAR"
                  : `${unacknowledgedAlerts} ACTIVE`}
              </Text>
            </Pressable>
          </View>
        </View>

        <View
          style={[
            styles.aquariumSettingsPanel,
            !aquariumSettingsOpen
              ? styles.aquariumSettingsPanelHidden
              : undefined,
          ]}
        >
          <View style={styles.aquariumSettingsHeading}>
            <View style={styles.aquariumSettingsHeadingText}>
              <Text style={styles.eyebrow}>AQUARIUM SETTINGS</Text>
              <Text style={styles.aquariumSettingsTitle}>
                {twin.aquarium.name}
              </Text>
            </View>

            <WorkspaceCloseButton
              accessibilityLabel="Close aquarium settings"
              onPress={() => {
                cancelAquariumNameEdit();
                setAquariumSettingsOpen(false);
              }}
            />
          </View>

          {cloudMode ? (
            <View style={styles.aquariumSettingsSection}>
              <Pressable
                accessibilityLabel={`${aquariumsExpanded ? "Collapse" : "Expand"} aquariums`}
                accessibilityRole="button"
                accessibilityState={{ expanded: aquariumsExpanded }}
                onPress={() => setAquariumsExpanded((current) => !current)}
                style={styles.settingsDisclosureHeader}
              >
                <Text style={styles.cloudInventoryDisclosure}>
                  {aquariumsExpanded ? "▾" : "▸"}
                </Text>
                <Text style={styles.aquariumSettingsSectionTitle}>Aquariums</Text>
              </Pressable>
              {aquariumsExpanded ? (
                <>
                  <Text style={styles.aquariumSettingsSectionSummary}>
                    Add an aquarium or switch the dashboard to another aquarium.
                  </Text>
                  {accountAquariums.map((aquarium) => (
                    <View
                      key={aquarium.id}
                      style={[
                        styles.aquariumAccountRow,
                        aquarium.id === twin.aquarium.id
                          ? styles.aquariumAccountRowActive
                          : undefined,
                      ]}
                    >
                      <View style={styles.aquariumAccountRowCopy}>
                        <Text style={styles.aquariumAccountName}>{aquarium.name}</Text>
                        <Text style={styles.aquariumAccountRole}>
                          {aquarium.role}{aquarium.id === twin.aquarium.id ? " · Current" : ""}
                        </Text>
                      </View>
                      <View style={styles.aquariumAccountActions}>
                        {aquarium.id !== twin.aquarium.id ? (
                          <Pressable
                            accessibilityLabel={`Switch to ${aquarium.name}`}
                            accessibilityRole="button"
                            disabled={aquariumLifecycleBusyId !== null}
                            onPress={() => void switchAquarium(aquarium.id)}
                          >
                            <Text style={styles.aquariumSwitchText}>Switch</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          accessibilityLabel={`Archive ${aquarium.name}`}
                          accessibilityRole="button"
                          disabled={aquariumLifecycleBusyId !== null}
                          onPress={() => confirmArchiveAquarium(aquarium)}
                        >
                          <Text style={styles.aquariumArchiveText}>
                            {aquariumLifecycleBusyId === aquarium.id ? "Working…" : "Archive"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                  <View style={styles.addAquariumRow}>
                    <TextInput
                      accessibilityLabel="New aquarium name"
                      autoCapitalize="words"
                      editable={!addingAquarium}
                      maxLength={80}
                      onChangeText={setNewAquariumName}
                      onSubmitEditing={() => void addAquarium()}
                      placeholder="New aquarium name"
                      placeholderTextColor="#71869F"
                      returnKeyType="done"
                      style={styles.inlineNameInput}
                      value={newAquariumName}
                    />
                    <Pressable
                      accessibilityLabel="Add aquarium"
                      accessibilityRole="button"
                      disabled={addingAquarium || !newAquariumName.trim()}
                      onPress={() => void addAquarium()}
                      style={[
                        styles.settingsActionButton,
                        addingAquarium || !newAquariumName.trim()
                          ? styles.buttonDisabled
                          : undefined,
                      ]}
                    >
                      <Text style={styles.settingsActionText}>
                        {addingAquarium ? "Adding…" : "+ Add"}
                      </Text>
                    </Pressable>
                  </View>
                  {archivedAquariums.length > 0 ? (
                    <View style={styles.archivedAquariumsSection}>
                      <Text style={styles.aquariumSettingsSectionTitle}>Archived</Text>
                      <Text style={styles.aquariumSettingsSectionSummary}>
                        Archived aquariums retain their settings and history.
                      </Text>
                      {archivedAquariums.map((aquarium) => (
                        <View key={aquarium.id} style={styles.aquariumAccountRow}>
                          <View style={styles.aquariumAccountRowCopy}>
                            <Text style={styles.aquariumAccountName}>{aquarium.name}</Text>
                            <Text style={styles.aquariumAccountRole}>Archived</Text>
                          </View>
                          <Pressable
                            accessibilityLabel={`Restore ${aquarium.name}`}
                            accessibilityRole="button"
                            disabled={aquariumLifecycleBusyId !== null}
                            onPress={() => void restoreAquarium(aquarium)}
                          >
                            <Text style={styles.aquariumSwitchText}>
                              {aquariumLifecycleBusyId === aquarium.id ? "Working…" : "Restore"}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {aquariumListError ? (
                    <Text style={styles.outletTransferError}>{aquariumListError}</Text>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}

          <View style={styles.aquariumSettingsSection}>
            <Text style={styles.aquariumSettingsSectionTitle}>
              Aquarium Details
            </Text>

            <Text style={styles.aquariumSettingsSectionSummary}>
              Name
            </Text>

            {editingAquariumName ? (
              <View style={styles.inlineNameEditor}>
                <TextInput
                  accessibilityLabel="Aquarium name"
                  autoCapitalize="words"
                  editable={!savingAquarium}
                  maxLength={80}
                  onChangeText={setAquariumName}
                  onSubmitEditing={() => void saveAquariumName()}
                  returnKeyType="done"
                  selectTextOnFocus
                  style={styles.inlineNameInput}
                  value={aquariumName}
                />
                <Pressable
                  accessibilityLabel="Save aquarium name"
                  accessibilityRole="button"
                  disabled={savingAquarium || !aquariumName.trim()}
                  onPress={() => void saveAquariumName()}
                  style={[
                    styles.inlineNameAction,
                    savingAquarium || !aquariumName.trim()
                      ? styles.buttonDisabled
                      : undefined,
                  ]}
                >
                  <Text style={styles.inlineNameCheck}>
                    {savingAquarium ? "…" : "✓"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Cancel editing aquarium name"
                  accessibilityRole="button"
                  disabled={savingAquarium}
                  onPress={cancelAquariumNameEdit}
                  style={styles.inlineNameCancel}
                >
                  <Text style={styles.inlineNameCancelText}>×</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.inlineNameDisplay}>
                <Text style={styles.aquariumNameText}>{twin.aquarium.name}</Text>
                <Pressable
                  accessibilityLabel="Edit aquarium name"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    setAquariumName(twin.aquarium.name);
                    setAquariumError(null);
                    editingAquariumNameRef.current = true;
                    setEditingAquariumName(true);
                  }}
                  style={styles.inlineNameAction}
                >
                  <Text style={styles.inlineNamePencil}>✎</Text>
                </Pressable>
              </View>
            )}

            {aquariumError ? (
              <Text
                style={{
                  color: "#FCA5A5",
                  fontSize: 13,
                  marginTop: 7,
                }}
              >
                {aquariumError}
              </Text>
            ) : null}

          </View>

          <View style={styles.aquariumSettingsSection}>
            {cloudMode ? (
              <>
                <Text style={styles.aquariumSettingsSectionTitle}>
                  Reef Controllers
                </Text>
                {reefControllers.length > 0 ? (
                  reefControllers.map((controller) => {
                    const displayName = controllerDisplayName(controller);
                    const lastSeen = controller.lastSeenAt
                      ? new Date(controller.lastSeenAt).toLocaleString()
                      : "Not connected yet";
                    const isOnline = controller.status === "online";
                    return (
                      <View key={controller.id} style={styles.reefControllerCard}>
                        <View style={styles.reefControllerHeading}>
                          <View style={styles.reefControllerIdentity}>
                            <View
                              accessibilityLabel={isOnline ? "Online" : "Offline"}
                              style={[
                                styles.reefControllerStatus,
                                isOnline
                                  ? styles.reefControllerStatusOnline
                                  : styles.reefControllerStatusOffline,
                              ]}
                            />
                            {editingControllerId === controller.id ? (
                              <View style={styles.reefControllerNameEditor}>
                                <TextInput
                                  accessibilityLabel="Reef Controller name"
                                  autoCapitalize="words"
                                  editable={savingControllerId === null}
                                  maxLength={100}
                                  onChangeText={setControllerName}
                                  onSubmitEditing={() => void saveControllerName(controller.id)}
                                  returnKeyType="done"
                                  selectTextOnFocus
                                  style={styles.inlineNameInput}
                                  value={controllerName}
                                />
                                <Pressable
                                  accessibilityLabel="Save Reef Controller name"
                                  accessibilityRole="button"
                                  disabled={savingControllerId !== null || !controllerName.trim()}
                                  onPress={() => void saveControllerName(controller.id)}
                                  style={styles.inlineNameAction}
                                >
                                  <Text style={styles.inlineNameCheck}>
                                    {savingControllerId === controller.id ? "…" : "✓"}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  accessibilityLabel="Cancel editing Reef Controller name"
                                  accessibilityRole="button"
                                  disabled={savingControllerId !== null}
                                  onPress={() => {
                                    setEditingControllerId(null);
                                    setControllerName("");
                                    setControllerNameError(null);
                                  }}
                                  style={styles.inlineNameCancel}
                                >
                                  <Text style={styles.inlineNameCancelText}>×</Text>
                                </Pressable>
                              </View>
                            ) : (
                              <View style={styles.reefControllerNameDisplay}>
                                <Text style={styles.reefControllerName}>{displayName}</Text>
                                <Pressable
                                  accessibilityLabel={`Edit ${displayName} name`}
                                  accessibilityRole="button"
                                  hitSlop={8}
                                  onPress={() => {
                                    setControllerActionMenuId(null);
                                    setControllerName(displayName);
                                    setControllerNameError(null);
                                    setEditingControllerId(controller.id);
                                  }}
                                  style={styles.inlineNameAction}
                                >
                                  <Text style={styles.inlineNamePencil}>✎</Text>
                                </Pressable>
                              </View>
                            )}
                          </View>
                          <Pressable
                            accessibilityLabel={`Controller settings for ${displayName}`}
                            accessibilityRole="button"
                            onPress={() => setControllerActionMenuId((current) =>
                              current === controller.id ? null : controller.id
                            )}
                            style={styles.reefControllerGearButton}
                          >
                            <GearIcon />
                          </Pressable>
                        </View>
                        <Text style={styles.reefControllerDetails}>
                          {isOnline ? "Online" : "Offline"}
                          {controller.softwareVersion
                            ? ` · Software ${controller.softwareVersion}`
                            : ""}
                        </Text>
                        <Text style={styles.reefControllerDetails}>
                          Last contact: {lastSeen}
                        </Text>
                        <Text style={styles.reefControllerDetails}>
                          Controller software: {(() => {
                            const update = controller.runtimeState.controllerUpdate;
                            if (!update) return "Status pending";
                            return ({
                              idle: "Ready",
                              requested: "Check requested",
                              checking: "Checking…",
                              installing: "Installing…",
                              "up-to-date": "Up to date",
                              succeeded: "Updated successfully",
                              failed: "Update failed",
                            } as const)[update.status];
                          })()}
                        </Text>
                        {controller.runtimeState.controllerUpdate?.installedRelease ? (
                          <Text style={styles.reefControllerDetails}>
                            Release {controller.runtimeState.controllerUpdate.installedRelease.slice(0, 12)}
                            {controller.runtimeState.controllerUpdate.automaticUpdatesEnabled
                              ? " · Automatic updates on"
                              : " · Automatic updates unavailable"}
                          </Text>
                        ) : null}
                        <Text style={styles.reefControllerDetails}>
                          Channel: {controller.runtimeState.controllerUpdate?.releaseChannel === "staging"
                            ? "Staging"
                            : "Production"}
                        </Text>
                        {editingControllerId === controller.id && controllerNameError ? (
                          <Text style={styles.outletTransferError}>{controllerNameError}</Text>
                        ) : null}
                        {controllerUpdateError && controllerActionMenuId === controller.id ? (
                          <Text style={styles.outletTransferError}>{controllerUpdateError}</Text>
                        ) : null}
                        {selectedLocalControllerId === controller.id ? (
                          <Text style={styles.reefControllerSelectedText}>
                            Selected for device administration
                          </Text>
                        ) : null}
                        {controllerActionMenuId === controller.id ? (
                          <View style={styles.reefControllerActionMenu}>
                            <View style={styles.reefControllerChannelRow}>
                              <Text style={styles.reefControllerChannelLabel}>Release channel</Text>
                              {(["production", "staging"] as const).map((channel) => {
                                const selected = (controller.runtimeState.controllerUpdate?.releaseChannel ?? "production") === channel;
                                return (
                                  <Pressable
                                    accessibilityLabel={`Use ${channel} releases for ${displayName}`}
                                    accessibilityRole="button"
                                    disabled={!isOnline || controllerUpdateBusyId !== null}
                                    key={channel}
                                    onPress={() => void changeControllerReleaseChannel(controller, channel)}
                                    style={[
                                      styles.reefControllerChannelButton,
                                      selected ? styles.reefControllerChannelButtonSelected : undefined,
                                    ]}
                                  >
                                    <Text style={selected
                                      ? styles.reefControllerChannelTextSelected
                                      : styles.reefControllerChannelText}
                                    >
                                      {channel === "production" ? "Production" : "Staging"}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                            <Pressable
                              accessibilityLabel={`Check ${displayName} for software updates`}
                              accessibilityRole="button"
                              disabled={!isOnline || controllerUpdateBusyId !== null}
                              onPress={() => void checkControllerForUpdates(controller)}
                              style={[
                                styles.reefControllerAction,
                                !isOnline || controllerUpdateBusyId !== null
                                  ? styles.buttonDisabled
                                  : undefined,
                              ]}
                            >
                              <Text style={styles.reefControllerManageText}>
                                {controllerUpdateBusyId === controller.id
                                  ? "Requesting update check…"
                                  : "Check for Updates"}
                              </Text>
                            </Pressable>
                            {controller.lastSeenAt ? (
                              <>
                                <Pressable
                                  accessibilityLabel={`Manage devices on ${displayName}`}
                                  accessibilityRole="button"
                                  disabled={localControllerBusyId !== null}
                                  onPress={() => {
                                    setControllerActionMenuId(null);
                                    void selectLocalController(controller);
                                  }}
                                  style={styles.reefControllerAction}
                                >
                                  <Text style={styles.reefControllerManageText}>
                                    {localControllerBusyId === controller.id
                                      ? "Checking local connection…"
                                      : "Manage devices"}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  accessibilityLabel={`Reprovision ${displayName}`}
                                  accessibilityRole="button"
                                  disabled={localControllerBusyId !== null}
                                  onPress={() => {
                                    setControllerActionMenuId(null);
                                    confirmReprovisionController(controller);
                                  }}
                                  style={styles.reefControllerAction}
                                >
                                  <Text style={styles.reefControllerReprovisionText}>
                                    Reprovision reset controller
                                  </Text>
                                </Pressable>
                              </>
                            ) : null}
                            <Pressable
                              accessibilityLabel={`Remove ${displayName}`}
                              accessibilityRole="button"
                              disabled={removingControllerId === controller.id}
                              onPress={() => {
                                setControllerActionMenuId(null);
                                confirmRemoveController(controller);
                              }}
                              style={styles.reefControllerAction}
                            >
                              <Text style={styles.reefControllerRemoveText}>
                                {removingControllerId === controller.id
                                  ? "Removing…"
                                  : "Remove Reef Controller"}
                              </Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.aquariumSettingsSectionSummary}>
                    No Reef Controllers registered.
                  </Text>
                )}
                {controllerRemovalError ? (
                  <Text style={styles.outletTransferError}>{controllerRemovalError}</Text>
                ) : null}
                <Pressable
                  accessibilityLabel={`${cloudDevicesExpanded ? "Collapse" : "Expand"} devices`}
                  accessibilityRole="button"
                  onPress={() => setCloudDevicesExpanded((current) => !current)}
                  style={styles.devicesSectionHeader}
                >
                  <Text style={styles.cloudInventoryDisclosure}>
                    {cloudDevicesExpanded ? "▾" : "▸"}
                  </Text>
                  <Text style={styles.aquariumSettingsSectionTitle}>Devices</Text>
                </Pressable>
                {cloudDevicesExpanded ? (
                  <>
                    {localControllerError ? (
                      <Text style={styles.outletTransferError}>{localControllerError}</Text>
                    ) : null}
                    {cloudEquipmentInventory.length === 0 ? (
                      <Text style={styles.aquariumSettingsSectionSummary}>
                        No managed devices have been reported for this aquarium.
                      </Text>
                    ) : cloudEquipmentInventory.map((group) => (
                    <View key={group.key} style={styles.cloudInventoryCard}>
                      {editingCloudDeviceKey === group.key ? (
                        <View style={styles.cloudInventoryNameEditor}>
                          <TextInput
                            accessibilityLabel="Device name"
                            autoCapitalize="words"
                            autoCorrect={false}
                            editable={cloudDeviceBusyKey === null}
                            maxLength={48}
                            onChangeText={setCloudDeviceName}
                            onSubmitEditing={() => void saveCloudDeviceName(
                              group.key, group.controllerId, group.deviceId,
                            )}
                            returnKeyType="done"
                            selectTextOnFocus
                            style={styles.inlineNameInput}
                            value={cloudDeviceName}
                          />
                          <Pressable
                            accessibilityLabel="Save device name"
                            accessibilityRole="button"
                            disabled={!cloudDeviceName.trim() || cloudDeviceBusyKey !== null}
                            onPress={() => void saveCloudDeviceName(
                              group.key, group.controllerId, group.deviceId,
                            )}
                            style={styles.inlineNameAction}
                          >
                            <Text style={styles.inlineNameCheck}>
                              {cloudDeviceBusyKey === group.key ? "…" : "✓"}
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityLabel="Cancel editing device name"
                            accessibilityRole="button"
                            disabled={cloudDeviceBusyKey !== null}
                            onPress={() => {
                              setEditingCloudDeviceKey(null);
                              setCloudDeviceName("");
                              setCloudDeviceError(null);
                            }}
                            style={styles.inlineNameCancel}
                          >
                            <Text style={styles.inlineNameCancelText}>×</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.cloudInventoryHeadingRow}>
                          <Pressable
                            accessibilityLabel={`${expandedCloudDeviceKeys.has(group.key) ? "Collapse" : "Expand"} equipment channels for ${group.deviceName}`}
                            accessibilityRole="button"
                            onPress={() => setExpandedCloudDeviceKeys((current) => {
                              const next = new Set(current);
                              if (next.has(group.key)) next.delete(group.key);
                              else next.add(group.key);
                              return next;
                            })}
                            style={styles.cloudInventoryToggle}
                          >
                            <Text style={styles.cloudInventoryDisclosure}>
                              {expandedCloudDeviceKeys.has(group.key) ? "▾" : "▸"}
                            </Text>
                          </Pressable>
                          <View style={styles.cloudInventoryNameDisplay}>
                            <Text style={styles.cloudInventoryDeviceName}>
                              {group.deviceName}
                            </Text>
                            {group.controllerId && group.deviceId ? (
                              <Pressable
                                accessibilityLabel={`Edit ${group.deviceName} name`}
                                accessibilityRole="button"
                                disabled={cloudDeviceBusyKey !== null}
                                hitSlop={8}
                                onPress={() => {
                                  setEditingCloudDeviceKey(group.key);
                                  setCloudDeviceName(group.deviceName);
                                  setCloudDeviceError(null);
                                }}
                                style={styles.inlineNameAction}
                              >
                                <Text style={styles.inlineNamePencil}>✎</Text>
                              </Pressable>
                            ) : null}
                          </View>
                          {group.controllerId && group.deviceId ? (
                            <View style={styles.cloudInventoryActions}>
                              <Pressable
                                accessibilityLabel={`Delete ${group.deviceName}`}
                                disabled={cloudDeviceBusyKey !== null}
                                onPress={() => confirmDeleteCloudDevice(group)}
                                style={styles.cloudInventoryDeleteButton}
                              >
                                <Text style={styles.cloudInventoryDeleteText}>
                                  {cloudDeviceBusyKey === group.key ? "Working…" : "Delete"}
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      )}
                      <Text style={styles.cloudInventoryControllerName}>
                        {group.equipment.length} {group.equipment.length === 1 ? "channel" : "channels"}
                      </Text>
                      {expandedCloudDeviceKeys.has(group.key)
                        ? group.equipment.map((equipment) => (
                            <View key={equipment.id} style={styles.cloudInventoryChannel}>
                              <View style={styles.cloudInventoryChannelText}>
                                <Text style={styles.cloudInventoryChannelName}>
                                  {equipment.name}
                                </Text>
                                <Text style={styles.cloudInventoryChannelConnection}>
                                  {equipmentConnectionLabel(equipment.physicalConnectionId)}
                                </Text>
                              </View>
                              <Text style={styles.cloudInventoryChannelStatus}>
                                {equipment.connectionStatus === "online" ? "Online" : "Offline"}
                              </Text>
                            </View>
                          ))
                        : null}
                    </View>
                    ))}
                    {cloudDeviceError ? (
                      <Text style={styles.outletTransferError}>{cloudDeviceError}</Text>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.aquariumSettingsSectionTitle}>Devices</Text>
                <OnboardingPanel
                  onDeviceConnected={refreshAfterDeviceConnected}
                />
                <ManagedDevicesPanel
                  refreshVersion={managedDevicesRefreshVersion}
                  onDeviceDeleted={(deviceId) => {
                    setSelectedEquipmentId(null);
                    setTwin((current) => ({
                      ...current,
                      devices: (current.devices ?? []).filter(
                        (device) => device.id !== deviceId,
                      ),
                      equipment: current.equipment.filter(
                        (equipment) =>
                          equipment.binding?.deviceId !== deviceId,
                      ),
                    }));
                  }}
                />
              </>
            )}
          </View>

          {cloudMode && cloudAuth ? (
            <View style={styles.aquariumSettingsSection}>
              <Pressable
                accessibilityLabel={`${securityExpanded ? "Collapse" : "Expand"} security`}
                accessibilityRole="button"
                accessibilityState={{ expanded: securityExpanded }}
                onPress={() => setSecurityExpanded((current) => !current)}
                style={styles.devicesSectionHeader}
              >
                <Text style={styles.cloudInventoryDisclosure}>
                  {securityExpanded ? "▾" : "▸"}
                </Text>
                <Text style={styles.aquariumSettingsSectionTitle}>Security</Text>
              </Pressable>
              {securityExpanded ? (
                <>
                  <Text style={styles.aquariumSettingsSectionSummary}>
                    {Platform.OS === "web"
                      ? "Biometric unlock is available in the tablet and phone apps."
                      : cloudAuth.biometricAvailable
                        ? `${cloudAuth.biometricLabel} can unlock this device after you sign in.`
                        : "No enrolled Face ID, Touch ID, or fingerprint was found on this device."}
                  </Text>
                  {Platform.OS !== "web" && cloudAuth.biometricAvailable ? (
                    <Pressable
                      accessibilityLabel={`${cloudAuth.biometricEnabled ? "Disable" : "Enable"} ${cloudAuth.biometricLabel}`}
                      accessibilityRole="button"
                      accessibilityState={{ checked: cloudAuth.biometricEnabled, disabled: biometricSettingBusy }}
                      disabled={biometricSettingBusy}
                      onPress={() => {
                        setBiometricSettingBusy(true);
                        void cloudAuth.setBiometricEnabled(!cloudAuth.biometricEnabled)
                          .finally(() => setBiometricSettingBusy(false));
                      }}
                      style={({ pressed }) => [
                        styles.settingsActionButton,
                        { opacity: biometricSettingBusy ? 0.5 : pressed ? 0.75 : 1 },
                      ]}
                    >
                      <Text style={styles.settingsActionText}>
                        {biometricSettingBusy
                          ? "Checking…"
                          : cloudAuth.biometricEnabled
                            ? `Disable ${cloudAuth.biometricLabel}`
                            : `Enable ${cloudAuth.biometricLabel}`}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}

          {cloudMode && cloudAuth ? (
            <View style={styles.aquariumSettingsSection}>
              <Text style={styles.aquariumSettingsSectionTitle}>Actions</Text>
              <Text style={styles.aquariumSettingsSectionSummary}>
                Controller and account actions.
              </Text>
              <View style={styles.settingsActionRow}>
                {Platform.OS !== "web" && selectedLocalControllerId ? (
                  <OnboardingPanel
                    compact
                    onDeviceConnected={refreshAfterDeviceConnected}
                  />
                ) : null}
                {Platform.OS !== "web" ? (
                  <Pressable
                    accessibilityLabel="Add Reef Controller"
                    accessibilityRole="button"
                    onPress={() => setCloudEdgeSetupRequired(true)}
                    style={styles.settingsActionButton}
                  >
                    <Text style={styles.settingsActionText}>
                      + Add Reef Controller
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  disabled={signingOut}
                  onPress={() => {
                    setSigningOut(true);
                    void cloudAuth.signOut().catch(() => setSigningOut(false));
                  }}
                  style={({ pressed }) => [
                    styles.settingsActionButton,
                    styles.settingsDangerActionButton,
                    { opacity: signingOut ? 0.5 : pressed ? 0.75 : 1 },
                  ]}
                >
                  <Text style={styles.settingsDangerActionText}>
                    {signingOut ? "Signing out…" : "Sign out"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={[
          styles.systemActionBar,
          isDesktopWeb ? styles.systemActionBarDesktop : undefined,
        ]}>
          <SystemAction
            {...(unacknowledgedAlerts > 0
              ? { badge: unacknowledgedAlerts }
              : {})}
            icon={<AlertIcon active={unacknowledgedAlerts > 0} />}
            label="Alerts"
            onPress={() => setAlertsOpen(true)}
            desktop={isDesktopWeb}
          />
          <SystemAction
            icon={<CalendarIcon />}
            label="Schedule"
            onPress={() => setScheduleOpen(true)}
            desktop={isDesktopWeb}
          />
          {Platform.OS !== "web" && (!cloudMode || selectedLocalControllerId) ? (
            <SystemAction
              icon={<RoutinesIcon />}
              label="Routines"
              onPress={() => setRoutinesOpen(true)}
              desktop={isDesktopWeb}
            />
          ) : null}
          <SystemAction
            icon={<JournalIcon />}
            label="Journal"
            onPress={() => setJournalOpen(true)}
            desktop={isDesktopWeb}
          />
          <SystemAction
            icon={<GraphIcon />}
            label="Measurements"
            desktop={isDesktopWeb}
            onPress={() => {
              setAquariumSettingsOpen(false);
              setWaterTestsOpen(true);
            }}
          />
          <SystemAction
            icon={<NotesIcon />}
            label="Notes"
            desktop={isDesktopWeb}
            onPress={() => setNoteEntryRequest({ nonce: Date.now() })}
          />
          <SystemAction
            icon={<GearIcon />}
            label="System"
            onPress={() => setAquariumSettingsOpen(true)}
            desktop={isDesktopWeb}
          />
        </View>

        <View
          style={[
            styles.dashboardColumns,
            isWideLayout ? styles.dashboardColumnsWide : undefined,
            isDesktopWeb ? styles.dashboardColumnsDesktop : undefined,
          ]}
        >
        <View
          style={[
            styles.dashboardWaterColumn,
            isWideLayout ? styles.dashboardWaterColumnWide : undefined,
          ]}
        >
        <Text style={[
          styles.sectionTitle,
          isDesktopWeb ? styles.sectionTitleDesktop : undefined,
        ]}>Water Quality</Text>
        <View
          style={[
            styles.telemetryCard,
            styles.waterQualityTelemetryCard,
          ]}
        >
          <TelemetryRow desktop={isDesktopWeb} label="Temp" measurements={twin.measurements} onPress={() => setSelectedWaterMetric("temperature")} parameter="temperature" unit="°F" />
          <TelemetryRow desktop={isDesktopWeb} label="pH" measurements={twin.measurements} onPress={() => setSelectedWaterMetric("ph")} parameter="ph" unit="" />
          <TelemetryRow desktop={isDesktopWeb} label="ORP" measurements={twin.measurements} onPress={() => setSelectedWaterMetric("orp")} parameter="orp" unit="mV" />
          <TelemetryRow desktop={isDesktopWeb} label="Salinity" measurements={twin.measurements} onPress={() => setSelectedWaterMetric("salinity")} parameter="salinity" unit="ppt" />
        </View>
        </View>

        {!isWideLayout ? (
          <DashboardActivityColumn
            cloudMode={cloudMode}
            controllers={cloudMode ? reefControllers : [{
              id: "local", aquariumId: twin.aquarium.id, name: "Reef Controller",
              status: "online", softwareVersion: null, lastSeenAt: null,
              localHostname: null, runtimeState: { feedCycle: null },
            }]}
            feedControllerIds={feedControllerIds}
            reefCoachReport={reefCoachReport}
            onOpenReefCoach={() => setReefCoachOpen(true)}
            onOpenMeasurements={() => setWaterTestsOpen(true)}
            onStartTest={startTestEntry}
            wide={false}
            desktop={isDesktopWeb}
          />
        ) : null}

        <View
          style={[
            styles.dashboardEquipmentColumn,
            isWideLayout ? styles.dashboardEquipmentColumnWide : undefined,
          ]}
        >
        <View style={styles.equipmentWorkspace}>
          <View style={styles.equipmentColumn}>
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  isDesktopWeb ? styles.sectionTitleDesktop : undefined,
                  { marginBottom: 0 },
                ]}
              >
                Equipment · {twin.equipment.length}
              </Text>

              <Pressable
                accessibilityLabel={
                  equipmentLayoutUnlocked
                    ? "Lock equipment layout"
                    : "Unlock equipment layout"
                }
                accessibilityRole="button"
                onPress={toggleEquipmentLayout}
                style={({ pressed }) => ({
                  alignItems: "center",
                  height: 32,
                  justifyContent: "center",
                  opacity: pressed ? 0.7 : 1,
                  width: 32,
                })}
              >
                <LockIcon unlocked={equipmentLayoutUnlocked} />
              </Pressable>
            </View>

            {equipmentError ? (
              <Text style={styles.unboundText}>
                {equipmentError}
              </Text>
            ) : null}

            <View style={styles.listCard}>
              {visibleEquipment.length === 0 ? (
                <Text
                  style={{
                    color: "#8FA4BF",
                    paddingVertical: 20,
                    textAlign: "center",
                  }}
                >
                  No visible equipment
                </Text>
              ) : null}

              {visibleEquipment.map((equipment, index) => {
                const selected =
                  selectedEquipmentId === equipment.id;
                const displayedControlMode =
                  equipmentControlModeOverrides[equipment.id] ??
                  getEquipmentControlMode(equipment);
                const displayedEnabled =
                  displayedControlMode === "on"
                    ? true
                    : displayedControlMode === "off" ||
                        (displayedControlMode === "auto" &&
                          equipment.programType === "dosing-pump")
                      ? false
                      : equipment.enabled;

                return (
                  <Pressable
                    accessibilityLabel={`Open details for ${equipment.name}`}
                    accessibilityRole="button"
                    key={equipment.id}
                    onPress={() => {
                      if (!equipmentLayoutUnlocked) {
                        setSelectedEquipmentId(equipment.id);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.equipmentRow,
                      isDesktopWeb ? styles.equipmentRowDesktop : undefined,
                      index < visibleEquipment.length - 1
                        ? styles.equipmentRowBorder
                        : undefined,
                      selected && !equipmentLayoutUnlocked
                        ? styles.equipmentRowSelected
                        : undefined,
                      pressed && !equipmentLayoutUnlocked
                        ? styles.equipmentRowPressed
                        : undefined,
                      draggingEquipmentId === equipment.id
                        ? styles.equipmentRowDragging
                        : undefined,
                    ]}
                  >
                    <View
                      accessibilityActions={equipmentLayoutUnlocked ? [
                        { name: "increment", label: "Move down" },
                        { name: "decrement", label: "Move up" },
                      ] : undefined}
                      accessibilityLabel={equipmentLayoutUnlocked ? `Reorder ${equipment.name}` : undefined}
                      accessibilityRole={equipmentLayoutUnlocked ? "adjustable" : undefined}
                      onAccessibilityAction={(event) => {
                        if (event.nativeEvent.actionName === "increment") {
                          moveEquipment(equipment.id, 1);
                        } else if (event.nativeEvent.actionName === "decrement") {
                          moveEquipment(equipment.id, -1);
                        }
                      }}
                      onMoveShouldSetResponder={() => equipmentLayoutUnlocked}
                      onResponderGrant={(event) =>
                        beginEquipmentDrag(equipment.id, event.nativeEvent.pageY)
                      }
                      onResponderMove={(event) => updateEquipmentDrag(event.nativeEvent.pageY)}
                      onResponderRelease={finishEquipmentDrag}
                      onResponderTerminate={finishEquipmentDrag}
                      onResponderTerminationRequest={() => false}
                      onStartShouldSetResponder={() => equipmentLayoutUnlocked}
                      style={styles.equipmentDragSurface}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          equipment.connectionStatus !== "online"
                            ? styles.statusDotOffline
                            : undefined,
                        ]}
                      />

                      <View style={styles.equipmentText}>
                        <Text style={[
                          styles.equipmentName,
                          isDesktopWeb ? styles.equipmentNameDesktop : undefined,
                        ]}>
                          {equipment.name}
                        </Text>
                        <Text style={[
                          styles.equipmentRole,
                          isDesktopWeb ? styles.equipmentRoleDesktop : undefined,
                        ]}>
                          {equipmentRoleLabel(equipment.role)}
                          {" · "}
                          {equipment.connectionStatus === "online"
                            ? (displayedEnabled ? "on" : "off")
                            : "offline"}
                          {equipment.connectionStatus === "online" && typeof equipment.powerWatts === "number"
                            ? ` · ${equipment.powerWatts.toFixed(1)} W`
                            : ""}
                        </Text>
                      </View>
                    </View>

                    {equipmentLayoutUnlocked ? (
                      <View
                        style={{
                          alignItems: "center",
                          flexDirection: "row",
                          gap: 5,
                        }}
                      >
                        <Pressable
                          accessibilityLabel={`Hide ${equipment.name}`}
                          onPress={() =>
                            hideEquipment(equipment.id)
                          }
                          style={{
                            backgroundColor: "#102E4E",
                            borderRadius: 12,
                            paddingHorizontal: 9,
                            paddingVertical: 7,
                          }}
                        >
                          <Text
                            style={{
                              color: "#A9B7CA",
                              fontSize: 11,
                              fontWeight: "700",
                            }}
                          >
                            HIDE
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={[
                        styles.modeControl,
                        isDesktopWeb ? styles.modeControlDesktop : undefined,
                      ]}>
                        {equipmentControlModes.map((mode) => {
                          const active =
                            displayedControlMode === mode;
                          const busy =
                            controllingEquipmentId ===
                            equipment.id;

                          return (
                            <Pressable
                              key={mode}
                              accessibilityState={{
                                busy,
                                selected: active,
                              }}
                              onPress={(event) => {
                                event.stopPropagation();
                                if (active) return;
                                if (busy) {
                                  queuedEquipmentControlModes.current.set(
                                    equipment.id,
                                    mode,
                                  );
                                  pendingEquipmentControlModes.current.set(
                                    equipment.id,
                                    mode,
                                  );
                                  setEquipmentControlModeOverrides((current) => ({
                                    ...current,
                                    [equipment.id]: mode,
                                  }));
                                  setTwin((current) => ({
                                    ...current,
                                    equipment: current.equipment.map((item) =>
                                      item.id === equipment.id
                                        ? equipmentWithRequestedControlMode(item, mode)
                                        : item,
                                    ),
                                  }));
                                  return;
                                }
                                void updateEquipmentControlMode(
                                  equipment.id,
                                  mode,
                                );
                              }}
                              style={[
                                styles.modeSegment,
                                isDesktopWeb ? styles.modeSegmentDesktop : undefined,
                                active
                                  ? styles.modeSegmentSelected
                                  : undefined,
                                active && mode === "off"
                                  ? styles.modeSegmentOff
                                  : undefined,
                                active && mode === "auto"
                                  ? styles.modeSegmentAuto
                                  : undefined,
                                active && mode === "on"
                                  ? styles.modeSegmentOn
                                  : undefined,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.modeLabel,
                                  isDesktopWeb ? styles.modeLabelDesktop : undefined,
                                  active
                                    ? styles.modeLabelSelected
                                    : undefined,
                                ]}
                              >
                                {mode.toUpperCase()}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {equipmentLayoutUnlocked &&
            hiddenEquipment.length > 0 ? (
              <>
                <Text
                  style={[
                    styles.sectionTitle,
                    {
                      fontSize: 15,
                      marginTop: -8,
                    },
                  ]}
                >
                  Hidden Equipment
                </Text>

                <View style={styles.listCard}>
                  {hiddenEquipment.map((equipment, index) => (
                    <View
                      key={equipment.id}
                      style={[
                        styles.equipmentRow,
                        index < hiddenEquipment.length - 1
                          ? styles.equipmentRowBorder
                          : undefined,
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          styles.statusDotOffline,
                        ]}
                      />

                      <View style={styles.equipmentText}>
                        <Text style={styles.equipmentName}>
                          {equipment.name}
                        </Text>
                        <Text style={styles.equipmentRole}>
                          Hidden from normal view
                        </Text>
                      </View>

                      <Pressable
                        accessibilityLabel={`Show ${equipment.name}`}
                        onPress={() =>
                          showEquipment(equipment.id)
                        }
                        style={{
                          backgroundColor: "#123E6B",
                          borderRadius: 12,
                          paddingHorizontal: 11,
                          paddingVertical: 8,
                        }}
                      >
                        <Text
                          style={{
                            color: "#20B7EC",
                            fontSize: 11,
                            fontWeight: "800",
                          }}
                        >
                          SHOW
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>

        {selectedEquipment ? (
          <Modal
            animationType={isTablet ? "fade" : "slide"}
            onRequestClose={closeEquipmentDetail}
            transparent
            visible
          >
            <View
              style={[
                styles.equipmentDetailBackdrop,
                isTablet ? styles.equipmentDetailBackdropWide : undefined,
              ]}
            >
              <Pressable
                accessibilityLabel="Close equipment detail"
                accessibilityRole="button"
                onPress={closeEquipmentDetail}
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  styles.equipmentDetailSheet,
                  isTablet ? styles.equipmentDetailSheetWide : undefined,
                ]}
              >
                <View style={styles.equipmentDetailModalHeader}>
                  <View style={styles.equipmentDetailHeading}>
                    <Text style={styles.sectionTitle}>Equipment Detail</Text>
                    <Text style={styles.equipmentDetailContext}>
                      {[
                        twin.aquarium.name,
                        selectedEquipment.physicalDeviceName,
                        selectedPhysicalConnectionId
                          ? equipmentConnectionLabel(selectedPhysicalConnectionId)
                          : undefined,
                      ].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <WorkspaceCloseButton
                    accessibilityLabel="Close equipment detail"
                    onPress={closeEquipmentDetail}
                  />
                </View>
                <ScrollView
                  contentContainerStyle={styles.equipmentDetailScrollContent}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  scrollEnabled={equipmentDetailScrollEnabled}
                  showsVerticalScrollIndicator
                  style={styles.equipmentDetailScroller}
                >
            <View style={[styles.detailCard, styles.detailCardModal]}>
              <View style={styles.detailHeader}>
                <View style={styles.detailNameColumn}>
                  {editingEquipmentId === selectedEquipment.id ? (
                    <View>
                      <View style={styles.inlineNameEditor}>
                        <TextInput
                        accessibilityLabel="Equipment name"
                        autoCapitalize="words"
                        autoCorrect={false}
                        editable={!savingEquipment}
                        maxLength={48}
                        onChangeText={setEquipmentName}
                        onSubmitEditing={() =>
                          void saveEquipmentConfiguration()
                        }
                        placeholder="Equipment name"
                        placeholderTextColor="#6F7D93"
                        returnKeyType="done"
                        selectTextOnFocus
                        style={styles.inlineNameInput}
                        value={equipmentName}
                        />
                        <Pressable
                        accessibilityLabel="Save equipment name"
                        accessibilityRole="button"
                        disabled={
                          savingEquipment || !equipmentName.trim()
                        }
                        onPress={() =>
                          void saveEquipmentConfiguration()
                        }
                        style={[
                          styles.inlineNameAction,
                          savingEquipment || !equipmentName.trim()
                            ? styles.buttonDisabled
                            : undefined,
                        ]}
                      >
                        <Text style={styles.inlineNameCheck}>
                          {savingEquipment ? "…" : "✓"}
                        </Text>
                        </Pressable>
                        <Pressable
                        accessibilityLabel="Cancel editing equipment name"
                        accessibilityRole="button"
                        disabled={savingEquipment}
                        onPress={cancelEditingEquipment}
                        style={styles.inlineNameCancel}
                      >
                        <Text style={styles.inlineNameCancelText}>×</Text>
                        </Pressable>
                      </View>
                      <Text style={styles.editorEyebrow}>EQUIPMENT TYPE</Text>
                      <View style={styles.roleChoices}>
                        {(selectedEquipment.programTypeLocked
                          ? [selectedEquipment.role]
                          : equipmentRoleChoices
                        ).map((role) => (
                          <Pressable
                            key={role}
                            accessibilityRole="button"
                            disabled={selectedEquipment.programTypeLocked}
                            onPress={() => setEquipmentRole(role)}
                            style={[
                              styles.roleChoice,
                              equipmentRole === role
                                ? styles.roleChoiceSelected
                                : undefined,
                            ]}
                          >
                            <Text style={[
                              styles.roleChoiceText,
                              equipmentRole === role
                                ? styles.roleChoiceTextSelected
                                : undefined,
                            ]}>
                              {equipmentRoleLabel(role)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <View style={styles.inlineNameDisplay}>
                      <Text style={styles.detailName}>
                        {selectedEquipment.name}
                      </Text>
                      <Pressable
                        accessibilityLabel="Edit equipment name"
                        accessibilityRole="button"
                        onPress={beginEditingEquipment}
                        hitSlop={8}
                        style={styles.inlineNameAction}
                      >
                        <Text style={styles.inlineNamePencil}>✎</Text>
                      </Pressable>
                    </View>
                  )}
                </View>

                <Text
                  style={[
                    styles.detailState,
                    selectedEquipment.enabled
                      ? styles.detailStateOn
                      : styles.detailStateOff,
                  ]}
                >
                  {selectedEquipment.enabled ? "ON" : "OFF"}
                  {typeof selectedEquipment.powerWatts === "number"
                    ? ` · ${selectedEquipment.powerWatts.toFixed(1)} W`
                    : ""}
                </Text>
              </View>

              <DetailRow
                label="Connection"
                value={selectedEquipment.connectionStatus}
              />
              <DetailRow
                label="Health"
                value={selectedEquipment.healthStatus}
              />
              {typeof selectedEquipment.energyKwh === "number" ? (
                <DetailRow
                  label="Energy"
                  value={`${selectedEquipment.energyKwh.toFixed(3)} kWh`}
                />
              ) : null}

              {selectedPhysicalConnectionId ? (
                <>
                  {selectedEquipment.physicalDeviceName ? (
                    <DetailRow
                      label="Equipment"
                      value={selectedEquipment.physicalDeviceName}
                    />
                  ) : null}
                  <DetailRow
                    label="Physical connection"
                    value={equipmentConnectionLabel(
                      selectedPhysicalConnectionId,
                    )}
                  />
                </>
              ) : (
                <Text style={styles.unboundText}>
                  No physical device binding configured.
                </Text>
              )}

              {isDmpWavemaker(selectedEquipment) ? (
                <WavemakerProgramPanel
                  equipment={selectedEquipment}
                  settingsIcon={<GearIcon />}
                  wavemakers={twin.equipment.filter(isDmpWavemaker)}
                  onUpdated={(updated) =>
                    setTwin((current) => ({
                      ...current,
                      equipment: current.equipment.map((equipment) =>
                        equipment.id === updated.id ? updated : equipment
                      ),
                    }))
                  }
                  onTimelineGestureActive={handleTimelineGestureActive}
                />
              ) : <EquipmentProgramPanel
                key={`${selectedEquipment.id}:${
                  selectedEquipment.schedule?.enabled
                    ? "enabled"
                    : "disabled"
                }`}
                equipment={selectedEquipment}
                cloudMode={cloudMode}
                aquariumName={twin.aquarium.name}
                controllerName={controllerNames[selectedEquipment.id] ?? "Reef Controller"}
                setProgramType={setDashboardEquipmentProgramType}
                onUpdated={(updated) =>
                  setTwin((current) => ({
                    ...current,
                    equipment: current.equipment.map(
                      (equipment) =>
                        equipment.id === updated.id
                          ? updated
                          : equipment,
                    ),
                  }))
                }
                onTimelineGestureActive={handleTimelineGestureActive}
              />}

              {!isDmpWavemaker(selectedEquipment) &&
              selectedPhysicalConnectionId &&
              compatibleTransferTargets.length > 0 ? (
                <View style={styles.outletTransferActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openOutletTransfer("clone")}
                    style={styles.outletTransferButton}
                  >
                    <Text style={styles.outletTransferButtonText}>Clone Configuration</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openOutletTransfer("swap")}
                    style={styles.outletTransferButton}
                  >
                    <Text style={styles.outletTransferButtonText}>Swap Physical Outlet</Text>
                  </Pressable>
                </View>
              ) : null}

              <Modal
                animationType="fade"
                onRequestClose={closeOutletTransfer}
                transparent
                visible={outletTransferAction !== null}
              >
                <View style={styles.outletTransferBackdrop}>
                  <View style={styles.outletTransferCard}>
                    <Text style={styles.outletTransferTitle}>
                      {outletTransferAction === "clone"
                        ? `Clone ${selectedEquipment.name}`
                        : `Move ${selectedEquipment.name}`}
                    </Text>
                    <Text style={styles.outletTransferSummary}>
                      {outletTransferAction === "clone"
                        ? "Choose a compatible destination. Its automation configuration will be replaced; its current on/off state and calibration are preserved."
                        : "Choose a compatible outlet. The two physical connections will trade places while names, automation, and history stay with their equipment."}
                    </Text>

                    {compatibleTransferTargets.length === 0 ? (
                      <Text style={styles.outletTransferError}>
                        No compatible outlets are available.
                      </Text>
                    ) : (
                      <ScrollView
                        contentContainerStyle={styles.outletTransferChoices}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                        style={styles.outletTransferChoiceScroller}
                      >
                        {compatibleTransferTargets.map((equipment) => (
                          <Pressable
                            key={equipment.id}
                            onPress={() => {
                              setOutletTransferTargetId(equipment.id);
                              if (outletTransferAction === "clone") {
                                setClonedEquipmentName(`${selectedEquipment.name} Copy`);
                              }
                            }}
                            style={[
                              styles.outletTransferChoice,
                              outletTransferTargetId === equipment.id
                                ? styles.outletTransferChoiceSelected
                                : undefined,
                            ]}
                          >
                            <Text style={styles.outletTransferChoiceName}>{equipment.name}</Text>
                            <Text style={styles.outletTransferChoiceConnection}>
                              {[equipment.physicalDeviceName, equipmentConnectionLabel(equipment.physicalConnectionId)]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}

                    {outletTransferAction === "clone" && outletTransferTargetId ? (
                      <TextInput
                        accessibilityLabel="Cloned equipment name"
                        autoCapitalize="words"
                        maxLength={48}
                        onChangeText={setClonedEquipmentName}
                        placeholder="New equipment name"
                        placeholderTextColor="#6F7D93"
                        style={styles.outletTransferNameInput}
                        value={clonedEquipmentName}
                      />
                    ) : null}

                    {outletTransferAction === "swap" && outletTransferTargetId ? (
                      <Text style={styles.outletTransferMapping}>
                        {selectedEquipment.name}: {equipmentConnectionLabel(selectedEquipment.physicalConnectionId)} ↔ {compatibleTransferTargets.find((item) => item.id === outletTransferTargetId)?.name}: {equipmentConnectionLabel(compatibleTransferTargets.find((item) => item.id === outletTransferTargetId)?.physicalConnectionId)}
                      </Text>
                    ) : null}

                    {outletTransferError ? (
                      <Text style={styles.outletTransferError}>{outletTransferError}</Text>
                    ) : null}

                    <View style={styles.outletTransferFooter}>
                      <Pressable
                        disabled={outletTransferBusy}
                        onPress={closeOutletTransfer}
                        style={styles.outletTransferCancel}
                      >
                        <Text style={styles.outletTransferCancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        disabled={
                          outletTransferBusy ||
                          !outletTransferTargetId ||
                          (outletTransferAction === "clone" && !clonedEquipmentName.trim())
                        }
                        onPress={() => void completeOutletTransfer()}
                        style={[
                          styles.outletTransferConfirm,
                          outletTransferBusy ||
                          !outletTransferTargetId ||
                          (outletTransferAction === "clone" && !clonedEquipmentName.trim())
                            ? styles.buttonDisabled
                            : undefined,
                        ]}
                      >
                        <Text style={styles.outletTransferConfirmText}>
                          {outletTransferBusy
                            ? "Working…"
                            : outletTransferAction === "clone"
                              ? "Clone"
                              : "Swap Outlets"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Modal>

              <Pressable
                onPress={closeEquipmentDetail}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>Close Detail</Text>
              </Pressable>
            </View>
                </ScrollView>
              </View>
            </View>
          </Modal>
        ) : null}
        </View>
        </View>

        {isWideLayout ? (
          <DashboardActivityColumn
            cloudMode={cloudMode}
            controllers={cloudMode ? reefControllers : [{
              id: "local", aquariumId: twin.aquarium.id, name: "Reef Controller",
              status: "online", softwareVersion: null, lastSeenAt: null,
              localHostname: null, runtimeState: { feedCycle: null },
            }]}
            feedControllerIds={feedControllerIds}
            reefCoachReport={reefCoachReport}
            onOpenReefCoach={() => setReefCoachOpen(true)}
            onOpenMeasurements={() => setWaterTestsOpen(true)}
            onStartTest={startTestEntry}
            wide
            desktop={isDesktopWeb}
          />
        ) : null}
        </View>

      </ScrollView>

      <AquariumLogPanel
        modalOnly
        noteEntryRequest={noteEntryRequest}
        onNoteEntryClosed={() => setNoteEntryRequest(null)}
        onTestEntryClosed={() => setTestEntryRequest(null)}
        onTestSaved={() =>
          setWaterTestsRefreshVersion((current) => current + 1)
        }
        testEntryRequest={testEntryRequest}
      />

      {journalOpen ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setJournalOpen(false)}
          presentationStyle="pageSheet"
          visible
        >
          <SafeAreaView style={styles.journalScreen}>
            <View style={styles.journalScreenHeader}>
              <View>
                <Text style={styles.eyebrow}>AQUARIUM HISTORY</Text>
                <Text style={styles.journalScreenTitle}>Reef Journal</Text>
              </View>
              <WorkspaceCloseButton
                accessibilityLabel="Close Reef Journal"
                onPress={() => setJournalOpen(false)}
              />
            </View>
            <ScrollView contentContainerStyle={styles.journalScreenContent}>
              <AquariumLogPanel
                defaultExpanded
                onTestEntryClosed={() => setTestEntryRequest(null)}
                onTestSaved={() =>
                  setWaterTestsRefreshVersion((current) => current + 1)
                }
                testEntryRequest={testEntryRequest}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => setReefCoachOpen(false)}
        presentationStyle="pageSheet"
        visible={reefCoachOpen}
      >
        <SafeAreaView style={styles.journalScreen}>
          <View style={styles.journalScreenHeader}>
            <View>
              <Text style={styles.eyebrow}>OBSERVER MODE</Text>
              <Text style={styles.journalScreenTitle}>Reef Coach</Text>
            </View>
            <WorkspaceCloseButton accessibilityLabel="Close Reef Coach" onPress={() => setReefCoachOpen(false)} />
          </View>
          <ScrollView contentContainerStyle={styles.journalScreenContent}>
            <ReefCoachPanel
              analysisError={reefCoachAnalysisError}
              analyzing={reefCoachAnalyzing}
              {...(cloudMode ? { onAnalyze: analyzeReefCoach } : {})}
              report={reefCoachAnalysis ?? reefCoachReport}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedWaterMetric(null)}
        presentationStyle="pageSheet"
        visible={selectedWaterMetric !== null}
      >
        <SafeAreaView style={styles.journalScreen}>
          <View style={styles.journalScreenHeader}>
            <View>
              <Text style={styles.eyebrow}>WATER QUALITY</Text>
              <Text style={styles.journalScreenTitle}>
                {selectedWaterMetric ? alertRules.metrics[selectedWaterMetric].label : "Probe"}
              </Text>
            </View>
            <WorkspaceCloseButton accessibilityLabel="Close water quality detail" onPress={() => setSelectedWaterMetric(null)} />
          </View>
          <ScrollView contentContainerStyle={styles.journalScreenContent} keyboardShouldPersistTaps="handled">
            {selectedWaterMetric && waterQualitySensor ? (
              <WaterQualityDetailPanel
                measurements={twin.measurements}
                metric={selectedWaterMetric}
                onCalibrationChange={async (calibration) => {
                  const updated = await setDashboardWaterProbeCalibration(waterQualitySensor, calibration);
                  setWaterQualitySensor(updated);
                  setDashboardRefreshVersion((current) => current + 1);
                }}
                onRuleChange={(rule) => {
                  const next = {
                    ...alertRules,
                    metrics: { ...alertRules.metrics, [selectedWaterMetric]: rule },
                  };
                  return saveWaterAlarmRules(next);
                }}
                rule={alertRules.metrics[selectedWaterMetric]}
                sensor={waterQualitySensor}
              />
            ) : (
              <View style={styles.cloudStatusCard}><Text style={styles.cloudStatusCopy}>No water-quality sensor is connected.</Text></View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setAlertsOpen(false)}
        presentationStyle="pageSheet"
        visible={alertsOpen}
      >
        <SafeAreaView style={styles.journalScreen}>
          <View style={styles.journalScreenHeader}>
            <View>
              <Text style={styles.eyebrow}>SYSTEM SAFETY</Text>
              <Text style={styles.journalScreenTitle}>
                Alerts &amp; Diagnostics
              </Text>
            </View>
            <WorkspaceCloseButton
              accessibilityLabel="Close Alerts and Diagnostics"
              onPress={() => setAlertsOpen(false)}
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.journalScreenContent}
            directionalLockEnabled
          >
            <AlertsDiagnosticsPanel
              aquariumId={twin.aquarium.id}
              issues={diagnosticIssues}
              onAcknowledgedChange={setAcknowledgedAlerts}
              onRulesChange={setAlertRules}
              onRulesSave={(rules) => { void saveWaterAlarmRules(rules).catch(() => undefined); }}
              readings={alertReadings}
              refreshVersion={alertStateVersion}
              rules={alertRules}
              sharedAcknowledged={sharedAcknowledgedAlerts}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {scheduleOpen ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setScheduleOpen(false)}
          presentationStyle="pageSheet"
          visible
        >
          <SafeAreaView style={styles.journalScreen}>
            <View style={styles.journalScreenHeader}>
              <View>
                <Text style={styles.eyebrow}>AUTOMATION</Text>
                <Text style={styles.journalScreenTitle}>
                  Calendar &amp; Schedule
                </Text>
              </View>
              <WorkspaceCloseButton
                accessibilityLabel="Close Calendar and Schedule"
                onPress={() => setScheduleOpen(false)}
              />
            </View>
            <ScrollView contentContainerStyle={styles.journalScreenContent}>
              <ScheduleTasksPanel
                equipment={twin.equipment}
                onSelectEquipment={(equipmentId) => {
                  setSelectedEquipmentId(equipmentId);
                  setScheduleOpen(false);
                }}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}

      {routinesOpen ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setRoutinesOpen(false)}
          presentationStyle="pageSheet"
          visible
        >
          <SafeAreaView style={styles.journalScreen}>
            <View style={styles.journalScreenHeader}>
              <View>
                <Text style={styles.eyebrow}>SYSTEM ACTIONS</Text>
                <Text style={styles.journalScreenTitle}>Routines</Text>
              </View>
              <WorkspaceCloseButton
                accessibilityLabel="Close Routines"
                onPress={() => setRoutinesOpen(false)}
              />
            </View>
            <ScrollView contentContainerStyle={styles.journalScreenContent}>
              <RoutinesPanel
                equipment={cloudMode
                  ? twin.equipment.filter(
                      (equipment) =>
                        controllerIds[equipment.id] === selectedLocalControllerId,
                    )
                  : twin.equipment}
              />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

function SystemAction({
  badge,
  desktop,
  icon,
  label,
  onPress,
}: {
  badge?: number;
  desktop: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.systemAction,
        desktop ? styles.systemActionDesktop : undefined,
        pressed ? styles.systemActionPressed : undefined,
      ]}
    >
      <View style={styles.systemActionIcon}>
        {icon}
        {badge ? (
          <View style={styles.systemActionBadge}>
            <Text style={styles.systemActionBadgeText}>
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[
        styles.systemActionLabel,
        desktop ? styles.systemActionLabelDesktop : undefined,
      ]}>{label}</Text>
    </Pressable>
  );
}

function AlertIcon({ active }: { active: boolean }) {
  return (
    <View
      style={[
        styles.alertIcon,
        active ? styles.alertIconActive : undefined,
      ]}
    >
      <Text
        style={[
          styles.alertIconText,
          active ? styles.alertIconTextActive : undefined,
        ]}
      >
        !
      </Text>
    </View>
  );
}

function CalendarIcon() {
  return (
    <View accessibilityElementsHidden style={styles.calendarIcon}>
      <View style={styles.calendarIconHeader} />
      <View style={styles.calendarIconDotRow}>
        <View style={styles.calendarIconDot} />
        <View style={styles.calendarIconDot} />
        <View style={styles.calendarIconDot} />
      </View>
    </View>
  );
}

function RoutinesIcon() {
  return (
    <View accessibilityElementsHidden style={styles.routinesIcon}>
      <Text style={styles.routinesIconText}>↻</Text>
    </View>
  );
}

function WorkspaceCloseButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.workspaceCloseButton,
        pressed ? styles.workspaceCloseButtonPressed : undefined,
      ]}
    >
      <View accessibilityElementsHidden style={styles.workspaceCloseGlyph}>
        <View
          style={[
            styles.workspaceCloseGlyphBar,
            styles.workspaceCloseGlyphBarForward,
          ]}
        />
        <View
          style={[
            styles.workspaceCloseGlyphBar,
            styles.workspaceCloseGlyphBarBack,
          ]}
        />
      </View>
    </Pressable>
  );
}

function DashboardActivityColumn({
  cloudMode,
  controllers,
  desktop,
  feedControllerIds,
  reefCoachReport,
  onOpenReefCoach,
  onOpenMeasurements,
  onStartTest,
  wide,
}: {
  cloudMode: boolean;
  controllers: EdgeSummary[];
  desktop: boolean;
  feedControllerIds: string[];
  reefCoachReport: ReefCoachReport;
  onOpenReefCoach: () => void;
  onOpenMeasurements: () => void;
  onStartTest: (parameter: WaterParameter) => void;
  wide: boolean;
}) {
  return (
    <View
      style={[
        styles.dashboardActivityColumn,
        wide ? styles.dashboardActivityColumnWide : undefined,
      ]}
    >
      <Text style={[
        styles.sectionTitle,
        desktop ? styles.sectionTitleDesktop : undefined,
      ]}>Measurements</Text>
      <View style={[
        styles.measurementPanel,
        desktop ? styles.measurementPanelDesktop : undefined,
      ]}>
        <View style={[
          styles.quickTestChoices,
          desktop ? styles.quickTestChoicesDesktop : undefined,
        ]}>
          {quickTestParameters.map((item) => (
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
                styles.quickTestChoice,
                desktop ? styles.quickTestChoiceDesktop : undefined,
                { borderColor: item.color },
              ]}
            >
              {item.parameter === "other" ? (
                <FlaskIcon />
              ) : (
                <Text
                  style={[
                    styles.quickTestText,
                    desktop ? styles.quickTestTextDesktop : undefined,
                    { color: item.color },
                  ]}
                >
                  {item.label}
                </Text>
              )}
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="Open measurement graphs"
            accessibilityRole="button"
            onPress={onOpenMeasurements}
            style={[
              styles.measurementGraphButton,
              desktop ? styles.measurementGraphButtonDesktop : undefined,
            ]}
          >
            <GraphIcon />
          </Pressable>
        </View>
      </View>

      <FeedModePanel
        cloudMode={cloudMode}
        controllers={controllers}
        targetControllerIds={feedControllerIds}
        settingsIcon={<GearIcon />}
        showReconnectNotice
      />

      <Text style={[
        styles.sectionTitle,
        styles.coachSectionTitle,
        desktop ? styles.sectionTitleDesktop : undefined,
      ]}>
        Reef Coach
      </Text>

      <Pressable
        accessibilityLabel="Open Reef Coach"
        accessibilityRole="button"
        onPress={onOpenReefCoach}
        style={[
        styles.coachCard,
        desktop ? styles.coachCardDesktop : undefined,
      ]}>
        <View style={styles.coachIcon}>
          <Text style={styles.coachIconText}>{reefCoachReport.recommendation.severity === "info" ? "✓" : "!"}</Text>
        </View>

        <View style={styles.coachText}>
          <Text style={[
            styles.coachTitle,
            desktop ? styles.coachTitleDesktop : undefined,
          ]}>{reefCoachReport.recommendation.summary}</Text>
          <Text style={[
            styles.coachSummary,
            desktop ? styles.coachSummaryDesktop : undefined,
          ]}>
            {`${reefCoachReport.recommendation.confidence} confidence · Observer mode · Tap for evidence`}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function JournalIcon() {
  return (
    <View accessibilityElementsHidden style={styles.journalIcon}>
      <View style={styles.journalIconSpine} />
      <View style={[styles.journalIconLine, { top: 6 }]} />
      <View style={[styles.journalIconLine, { top: 11 }]} />
      <View style={[styles.journalIconLine, { top: 16 }]} />
    </View>
  );
}

function NotesIcon() {
  return (
    <View accessibilityElementsHidden style={styles.notesIcon}>
      <View style={styles.notesIconLine} />
      <View style={[styles.notesIconLine, styles.notesIconLineMiddle]} />
      <View style={[styles.notesIconLine, styles.notesIconLineShort]} />
    </View>
  );
}

function TelemetryRow({
  desktop,
  label,
  measurements,
  onPress,
  parameter,
  unit,
}: {
  desktop: boolean;
  label: string;
  measurements: WaterMeasurement[];
  onPress: () => void;
  parameter: WaterParameter;
  unit: string;
}) {
  const matching = measurements.filter((measurement) => measurement.parameter === parameter);
  const latest = [...matching].sort(
    (left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt),
  )[0];
  const displayValue = latest
    ? Number.isInteger(latest.value) ? String(latest.value) : latest.value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    : "—";

  return (
    <Pressable accessibilityLabel={`Open ${label} water quality details`} accessibilityRole="button" onPress={onPress} style={[
      styles.telemetryRow,
      desktop ? styles.telemetryRowDesktop : undefined,
    ]}>
      <View style={[
        styles.telemetryCurrent,
        desktop ? styles.telemetryCurrentDesktop : undefined,
      ]}>
        <Text style={[
          styles.telemetryLabel,
          desktop ? styles.telemetryLabelDesktop : undefined,
        ]}>{label}</Text>
        <View style={styles.telemetryValueRow}>
          <Text style={[
            styles.telemetryValue,
            desktop ? styles.telemetryValueDesktop : undefined,
          ]}>{displayValue}</Text>
          {(latest?.unit ?? unit) ? <Text style={[
            styles.telemetryUnit,
            desktop ? styles.telemetryUnitDesktop : undefined,
          ]}>{latest?.unit ?? unit}</Text> : null}
        </View>
        <Text style={[
          styles.telemetryStatus,
          desktop ? styles.telemetryStatusDesktop : undefined,
        ]}>
          {latest ? new Date(latest.measuredAt).toLocaleString() : "No data"}
        </Text>
      </View>
      <Text style={styles.telemetryDisclosure}>›</Text>
    </Pressable>
  );
}



const gearIconUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAEYUlEQVR4nO2dyW0sMQxE5Q8n5jychCNxEs5jQpt/asBuDLopqSiyqHqXuY24lNbW0poQQgghhBBCCCGEEEKI4rxFG4Dm++fxXFHO1+dHidj9izaAlVVC84ZeAJGJ+P55PNmF8B5tAAL2JERC3QJkSXwWO0agFoCYRwLYHAlgc2jnspZ+FzlXX13eKtQCbE5ZAaBrI2PttkApgKzTrqx2XUEpAIGjpAC8muuK3UBJAQg7dALI3s9mt++My8eg30FANZtMgT1s9fAd3Q1B/+wuSSPG9yZ+RT+9wiaPWL5i6UrZmSsnRmt8RgEcoP1F+BoqgN8czsz8z8pROsJOVMxmKNM/R0zRKvhNNwsQWKZrTXQtyLA4wxyDqeBFOp4h8WcY4+HeBXh8lcuY/NZ8bPP2dfjPrWo/O5B5eocG5etorC24CsBi0KoFj0gQPnrtSBoKrpcx3z+P59fnx9vxO2JbZmb984i729JsxQRG4xF7l0Ggku+DR1y7BBA93xU2evIEbwFU+31Bx9csgKr74hlBzRpaMwpATT8nlrzBugDV/rWg4n0rANV+bu7yB2kBVPtjcN8QUnHgJ5/+UuKKmDt6uzHPXbjZKC0AxPgFvcU7G9NjgKyDRLRdVf2EDAKzBcfLnop+Xgqgp9nLEhxvOxj9vMrjbQvAJIJV5TP5eZc/UxfAIILV5TL4aclb18gWXTgK5Fm9jGcRDzzi73pYM9s5Pa+WjNnP7lkA63y41+5d/ByaBloLyTIiH03mDn4OrwOw1JBZO6v7ObUQlD04KPsq+0l7Ojh6Ln4mmz1WaAVwB9sZvSjKCkDYkAA2RwLYHAlgcySAzZEANqesAHbZEjYLrQCyzcuz2WOFVgAWULW2au1vrbgAWptPXuXktzYpgOjgeH+uZbkOZyYPwwKITn4vM6eDGBi11+2WsNbW1Ywd9gR6xZx+T+BBRI3N6p/bnsCsyVd5f3G5JCpz8leXy+Bf2B1B0SNi7/KZ/IPcEcSU/IPqD0ciRXApAMbkH1TfEoYSQek7ghD392d/n2D2P3RH0At28qn0FTGvYEuuN+U/Bolrpm8IYVszr8Zsl1byjqBdcL8jqDX1mexAroixoFZgLah4w+8IEnmw5M3cAmhAmAfkWgZ8GigR+IKOb5cA1BVwEP5snFoBHzzimuqWsMPBqgJa4Z/7nsADvR1sp9zbwa3p9XALpV8Pb82uSmSTxyAEtL+en7DdBeBFRiEwxmM6iNEDtgxCYI4BJHjRAWgtRggV/NaGkM1Jsyl0dvMl04MRqI2m7ptCexgJCPKQpuU/UXjYho6fFWiwPBZ1Mp7WXWHTqgUyl2B5vLyZ5ZBKhB2eL5mGT6F6id7XH10+GrpZQPbgZrfvDJ0ABJaSAtjl6VgEJQUg7FAKIGs/m9WuKygFYEF3BdsoKwBhg67J+k2mWsnY/LemFmB7JIDNkQA2h1oAWfrdLHaMQC0AMQ+tcs9UvyzaizItQObLm4UQQgghsvEf7MEEZeuM6V0AAAAASUVORK5CYII=";

function GearIcon() {
  return (
    <Image accessibilityIgnoresInvertColors resizeMode="contain" source={{ uri: gearIconUri }} style={styles.gearIconImage} />
  );
}

function LockIcon({ unlocked = false }: { unlocked?: boolean }) {
  return (
    <View accessibilityElementsHidden style={styles.lockIcon}>
      <View
        style={[
          styles.lockIconShackle,
          unlocked ? styles.lockIconShackleUnlocked : undefined,
        ]}
      />
      <View style={styles.lockIconBody}>
        <View style={styles.lockIconKeyhole} />
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cloudStatusScreen: {
    alignItems: "center",
    backgroundColor: "#061528",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  cloudStatusCard: {
    alignItems: "center",
    backgroundColor: "#062B63",
    borderColor: "#20B7EC",
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 520,
    padding: 32,
    width: "100%",
  },
  cloudStatusLogo: { height: 183, width: 200 },
  cloudStatusTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 18,
    textAlign: "center",
  },
  cloudStatusCopy: {
    color: "#F5F8FC",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    textAlign: "center",
  },
  cloudStatusButton: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 12,
    marginTop: 20,
    minWidth: 160,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  cloudStatusButtonText: {
    color: "#062B63",
    fontSize: 16,
    fontWeight: "800",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#061528",
  },

  screen: {
    alignSelf: "center",
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 40,
    width: "100%",
  },

  screenTablet: {
    maxWidth: 1180,
    paddingHorizontal: 32,
    paddingTop: 32,
  },

  screenDesktop: {
    maxWidth: 1440,
    paddingHorizontal: 40,
    paddingTop: 36,
  },

  dashboardCommandArea: {
    width: "100%",
  },

  dashboardColumns: {
    alignItems: "stretch",
    width: "100%",
  },

  dashboardColumnsWide: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
  },

  dashboardColumnsDesktop: {
    gap: 24,
  },

  dashboardActivityColumn: {
    minWidth: 0,
    width: "100%",
  },

  dashboardActivityColumnWide: {
    flexBasis: 0,
    flex: 1.1,
    flexShrink: 1,
    minWidth: 0,
  },

  dashboardWaterColumn: {
    minWidth: 0,
    width: "100%",
  },

  dashboardWaterColumnWide: {
    flexBasis: 0,
    flex: 0.8,
    flexShrink: 1,
    minWidth: 0,
  },

  dashboardEquipmentColumn: {
    minWidth: 0,
    width: "100%",
  },

  dashboardEquipmentColumnWide: {
    flexBasis: 0,
    flex: 1.35,
    flexShrink: 1,
    minWidth: 0,
  },

  equipmentWorkspace: {
    width: "100%",
  },

  equipmentWorkspaceWide: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 24,
  },

  equipmentColumn: {
    flex: 1,
    minWidth: 0,
  },

  detailColumn: {
    flex: 1,
    minWidth: 0,
  },

  equipmentDetailBackdrop: {
    backgroundColor: "rgba(1, 10, 22, 0.78)",
    flex: 1,
    justifyContent: "flex-end",
  },

  equipmentDetailBackdropWide: {
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },

  equipmentDetailSheet: {
    backgroundColor: "#061A30",
    borderColor: "#175887",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: "94%",
    overflow: "hidden",
    width: "100%",
  },

  equipmentDetailSheetWide: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    maxHeight: "88%",
    maxWidth: 720,
  },

  equipmentDetailModalHeader: {
    alignItems: "center",
    borderBottomColor: "#153E63",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },

  equipmentDetailHeading: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },

  equipmentDetailContext: {
    color: "#8FA4BF",
    fontSize: 11,
    marginTop: 3,
  },

  equipmentDetailScroller: {
    flexGrow: 0,
  },

  equipmentDetailScrollContent: {
    padding: 16,
    paddingBottom: 28,
  },

  measurementScreenHeader: {
    alignItems: "center",
    borderBottomColor: "#153E63",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 26,
    paddingBottom: 16,
  },

  workspaceScreenTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    marginTop: 3,
  },

  workspaceCloseButton: {
    alignItems: "center",
    backgroundColor: "#172B42",
    borderColor: "#D45A6A",
    borderRadius: 19,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },

  workspaceCloseButtonPressed: {
    backgroundColor: "#3B2434",
  },

  workspaceCloseGlyph: {
    height: 16,
    position: "relative",
    width: 16,
  },

  workspaceCloseGlyphBar: {
    backgroundColor: "#FCA5A5",
    borderRadius: 1,
    height: 2,
    left: 1,
    position: "absolute",
    top: 7,
    width: 14,
  },

  workspaceCloseGlyphBarForward: {
    transform: [{ rotate: "45deg" }],
  },

  workspaceCloseGlyphBarBack: {
    transform: [{ rotate: "-45deg" }],
  },

  contextBanner: {
    alignItems: "center",
    backgroundColor: "#081F39",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    minHeight: 68,
    paddingHorizontal: 16,
  },

  contextBannerDesktop: {
    minHeight: 82,
    paddingHorizontal: 22,
    position: "relative",
    zIndex: 50,
  },

  tankSelector: {
    maxWidth: "34%",
    minWidth: 130,
    position: "relative",
    zIndex: 30,
  },

  tankSelectorButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },

  tankSelectorCopy: {
    flex: 1,
    minWidth: 0,
  },

  tankSelectorDesktop: {
    minWidth: 190,
  },

  aquariumSelectorMenu: {
    backgroundColor: "#061528",
    borderColor: "#214869",
    borderRadius: 10,
    borderWidth: 1,
    left: 0,
    minWidth: 210,
    overflow: "hidden",
    position: "absolute",
    top: 48,
    zIndex: 60,
  },

  aquariumSelectorItem: {
    borderBottomColor: "#153E63",
    borderBottomWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },

  aquariumSelectorItemActive: {
    backgroundColor: "#133A67",
  },

  aquariumSelectorItemText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  contextLabel: {
    color: "#6F879F",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },

  contextLabelDesktop: {
    fontSize: 11,
  },

  contextTankName: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 3,
  },

  contextTankNameDesktop: {
    fontSize: 14,
    marginTop: 4,
  },

  contextChevron: {
    color: "#20B7EC",
    fontSize: 18,
    lineHeight: 20,
  },

  contextBrandLogo: {
    height: 57,
    width: 198,
  },

  contextBrandLogoDesktop: {
    height: 66,
    width: 228,
  },

  contextBannerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
    maxWidth: "42%",
  },

  contextAlertControl: {
    alignItems: "center",
    borderColor: "#214869",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 9,
  },

  contextAlertControlDesktop: {
    minHeight: 40,
    paddingHorizontal: 13,
  },

  contextAlertControlActive: {
    backgroundColor: "#461F2A",
    borderColor: "#B94B5A",
  },

  contextAlertControlPressed: {
    opacity: 0.7,
  },

  contextAlertText: {
    color: "#78A0BE",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  contextAlertTextDesktop: {
    fontSize: 12,
  },

  contextAlertTextActive: {
    color: "#FCA5A5",
  },

  profileControl: {
    alignItems: "center",
    height: 30,
    justifyContent: "center",
    width: 30,
  },

  systemActionBar: {
    alignItems: "center",
    backgroundColor: "#071B31",
    borderColor: "#123A60",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 18,
    minHeight: 50,
    paddingHorizontal: 8,
    paddingVertical: 7,
    position: "relative",
    zIndex: 1,
  },

  systemActionBarDesktop: {
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  systemAction: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 34,
    paddingHorizontal: 10,
  },

  systemActionDesktop: {
    gap: 9,
    minHeight: 42,
    paddingHorizontal: 14,
  },

  systemActionPressed: {
    backgroundColor: "#0D3458",
    borderColor: "#1C527E",
  },

  systemActionIcon: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "relative",
    width: 24,
  },

  systemActionBadge: {
    alignItems: "center",
    backgroundColor: "#EF4444",
    borderColor: "#071B31",
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    justifyContent: "center",
    minWidth: 16,
    paddingHorizontal: 3,
    position: "absolute",
    right: -7,
    top: -5,
  },

  systemActionBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "900",
  },

  alertIcon: {
    alignItems: "center",
    borderColor: "#20B7EC",
    borderRadius: 9,
    borderWidth: 1.5,
    height: 18,
    justifyContent: "center",
    width: 18,
  },

  alertIconActive: {
    borderColor: "#F87171",
  },

  alertIconText: {
    color: "#20B7EC",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 14,
  },

  alertIconTextActive: {
    color: "#F87171",
  },

  calendarIcon: {
    borderColor: "#20B7EC",
    borderRadius: 4,
    borderWidth: 1.5,
    height: 18,
    overflow: "hidden",
    width: 19,
  },

  calendarIconHeader: {
    backgroundColor: "#20B7EC",
    height: 4,
    width: "100%",
  },

  calendarIconDotRow: {
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    marginTop: 4,
  },

  calendarIconDot: {
    backgroundColor: "#20B7EC",
    borderRadius: 1,
    height: 2,
    width: 2,
  },

  routinesIcon: {
    alignItems: "center",
    borderColor: "#20B7EC",
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },

  routinesIconText: {
    color: "#20B7EC",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 16,
  },

  systemActionLabel: {
    color: "#B7C7D9",
    fontSize: 11,
    fontWeight: "700",
  },

  systemActionLabelDesktop: {
    fontSize: 14,
  },

  journalIcon: {
    borderColor: "#20B7EC",
    borderRadius: 2,
    borderWidth: 1.5,
    height: 21,
    position: "relative",
    width: 19,
  },

  journalIconSpine: {
    backgroundColor: "#20B7EC",
    bottom: 2,
    left: 4,
    position: "absolute",
    top: 2,
    width: 1.5,
  },

  journalIconLine: {
    backgroundColor: "#20B7EC",
    height: 1.5,
    left: 8,
    position: "absolute",
    width: 7,
  },

  notesIcon: {
    borderColor: "#20B7EC",
    borderRadius: 3,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    paddingHorizontal: 4,
    width: 20,
  },

  notesIconLine: {
    backgroundColor: "#20B7EC",
    height: 1.5,
    marginVertical: 1.5,
    width: 10,
  },

  notesIconLineMiddle: {
    width: 8,
  },

  notesIconLineShort: {
    width: 6,
  },

  headerSettingsButtonActive: {
    backgroundColor: "#123C64",
    borderColor: "#20B7EC",
  },

  headerSettingsIcon: {
    color: "#C8D7E8",
    fontSize: 22,
    lineHeight: 25,
  },

  headerSubtitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 3,
  },

  headerInlineSettingsButton: {
    alignItems: "center",
    borderColor: "#153E63",
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    overflow: "visible",
    width: 30,
  },

  gearIconImage: {
    height: 22,
    width: 22,
  },

  lockIcon: {
    alignItems: "center",
    height: 22,
    justifyContent: "flex-end",
    position: "relative",
    width: 22,
  },

  lockIconShackle: {
    borderColor: "#20B7EC",
    borderBottomWidth: 0,
    borderRadius: 6,
    borderWidth: 2,
    height: 10,
    left: 5,
    position: "absolute",
    top: 1,
    width: 12,
  },

  lockIconShackleUnlocked: {
    borderLeftColor: "transparent",
    left: 9,
    transform: [{ rotate: "18deg" }],
  },

  lockIconBody: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#20B7EC",
    borderRadius: 3,
    borderWidth: 2,
    height: 13,
    justifyContent: "center",
    width: 18,
  },

  lockIconKeyhole: {
    backgroundColor: "#20B7EC",
    borderRadius: 2,
    height: 4,
    width: 3,
  },

  dashboardTools: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 10,
    minHeight: 44,
  },

  quickTestChoices: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "flex-start",
  },

  quickTestChoicesDesktop: {
    columnGap: 0,
    justifyContent: "space-between",
    rowGap: 6,
  },

  quickTestChoice: {
    alignItems: "center",
    backgroundColor: "#08213D",
    borderRadius: 15,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 48,
  },

  quickTestChoiceDesktop: {
    height: 40,
    width: "19%",
  },

  quickTestText: {
    fontSize: 11,
    fontWeight: "800",
  },

  quickTestTextDesktop: {
    fontSize: 12,
  },

  aquariumSettingsPanel: {
    backgroundColor: "#0A2949",
    borderColor: "#153E63",
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 28,
    padding: 22,
    width: "100%",
  },

  aquariumSettingsPanelHidden: {
    display: "none",
  },

  aquariumSettingsHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },

  aquariumSettingsHeadingText: {
    flex: 1,
  },

  aquariumSettingsTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    marginTop: 5,
  },

  aquariumSettingsSection: {
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    paddingTop: 18,
  },

  aquariumSettingsSectionTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 4,
  },

  aquariumSettingsSectionSummary: {
    color: "#8FA4BF",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  settingsDisclosureHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  aquariumAccountRow: {
    alignItems: "center",
    backgroundColor: "#061D34",
    borderColor: "#234968",
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    padding: 12,
  },
  aquariumAccountRowActive: {
    borderColor: "#20B7EC",
  },
  aquariumAccountRowCopy: {
    flex: 1,
  },
  aquariumAccountName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  aquariumAccountRole: {
    color: "#8FA4BF",
    fontSize: 11,
    marginTop: 3,
    textTransform: "capitalize",
  },
  aquariumSwitchText: {
    color: "#20B7EC",
    fontSize: 12,
    fontWeight: "800",
  },
  aquariumAccountActions: {
    alignItems: "flex-end",
    gap: 10,
    marginLeft: 12,
  },
  aquariumArchiveText: {
    color: "#FCA5A5",
    fontSize: 12,
    fontWeight: "800",
  },
  archivedAquariumsSection: {
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    marginTop: 16,
    paddingTop: 16,
  },
  addAquariumRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  reefControllerCard: {
    backgroundColor: "#061528",
    borderColor: "#234968",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 14,
  },
  reefControllerHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  reefControllerIdentity: { alignItems: "center", flexDirection: "row", flex: 1 },
  reefControllerNameDisplay: {
    alignItems: "center",
    flexDirection: "row",
    flex: 1,
  },
  reefControllerNameEditor: {
    alignItems: "center",
    flexDirection: "row",
    flex: 1,
    gap: 6,
  },
  reefControllerStatus: {
    borderRadius: 6,
    height: 12,
    marginRight: 9,
    width: 12,
  },
  reefControllerStatusOnline: { backgroundColor: "#2DD881" },
  reefControllerStatusOffline: { backgroundColor: "#E74C3C" },
  reefControllerName: { color: "#F5F8FC", fontSize: 16, fontWeight: "800" },
  reefControllerDetails: { color: "#9FB4C8", fontSize: 13, marginTop: 5 },
  reefControllerGearButton: {
    padding: 4,
  },
  reefControllerSelectedText: { color: "#20B7EC", fontSize: 12, marginTop: 8 },
  reefControllerActionMenu: {
    backgroundColor: "#0A2038",
    borderColor: "#234968",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  reefControllerAction: {
    borderBottomColor: "#234968",
    borderBottomWidth: 1,
    paddingVertical: 12,
  },
  reefControllerChannelRow: {
    alignItems: "center",
    borderBottomColor: "#234968",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 10,
  },
  reefControllerChannelLabel: { color: "#9FB4C8", flex: 1, fontSize: 12 },
  reefControllerChannelButton: {
    borderColor: "#20B7EC",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  reefControllerChannelButtonSelected: { backgroundColor: "#20B7EC" },
  reefControllerChannelText: { color: "#20B7EC", fontSize: 11, fontWeight: "700" },
  reefControllerChannelTextSelected: { color: "#02172B", fontSize: 11, fontWeight: "800" },
  reefControllerManageText: { color: "#20B7EC", fontSize: 13, fontWeight: "700" },
  reefControllerReprovisionText: { color: "#FFB15C", fontSize: 12, fontWeight: "700" },
  reefControllerRemoveText: { color: "#FF8A8A", fontSize: 13, fontWeight: "700" },
  devicesSectionHeader: {
    alignItems: "center",
    borderTopColor: "#234968",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 22,
    paddingTop: 18,
  },
  cloudInventoryCard: {
    backgroundColor: "#061D34",
    borderColor: "#234968",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    padding: 12,
  },
  cloudInventoryDeviceName: { color: "#F5F8FC", fontSize: 15, fontWeight: "800" },
  cloudInventoryHeadingRow: {
    alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 10,
  },
  cloudInventoryToggle: { alignItems: "center", flexDirection: "row" },
  cloudInventoryDisclosure: { color: "#20B7EC", fontSize: 18, width: 14 },
  cloudInventoryNameDisplay: {
    alignItems: "center", flexDirection: "row", flex: 1, gap: 2,
  },
  cloudInventoryActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  cloudInventoryDeleteButton: {
    borderColor: "#E74C3C", borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  cloudInventoryDeleteText: { color: "#FF8A8A", fontSize: 11, fontWeight: "800" },
  cloudInventoryNameEditor: { alignItems: "center", flexDirection: "row", gap: 8 },
  cloudInventoryControllerName: { color: "#8FA4BF", fontSize: 12, marginTop: 3 },
  cloudInventoryChannel: {
    alignItems: "center",
    borderTopColor: "#153E63",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 9,
    paddingTop: 9,
  },
  cloudInventoryChannelText: { flex: 1, paddingRight: 12 },
  cloudInventoryChannelName: { color: "#DCE7F3", fontSize: 13, fontWeight: "700" },
  cloudInventoryChannelConnection: { color: "#8FA4BF", fontSize: 11, marginTop: 2 },
  cloudInventoryChannelStatus: { color: "#8FA4BF", fontSize: 11, fontWeight: "700" },

  settingsActionRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  settingsActionButton: {
    alignItems: "center",
    borderColor: "#20B7EC",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  settingsActionText: {
    color: "#20B7EC",
    fontSize: 12,
    fontWeight: "800",
  },
  settingsDangerActionButton: { borderColor: "#F87171" },
  settingsDangerActionText: { color: "#FCA5A5", fontSize: 12, fontWeight: "800" },

  brand: {
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
  },

  brandAccent: {
    color: "#20B7EC",
  },

  subtitle: {
    color: "#8FA4BF",
    fontSize: 15,
  },

  heroCard: {
    backgroundColor: "#0A2949",
    borderRadius: 22,
    padding: 22,
    marginBottom: 28,
  },

  heroCardWide: {
    borderRadius: 18,
    padding: 14,
  },

  telemetryCard: {
    backgroundColor: "#081F39",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 28,
    overflow: "hidden",
  },

  waterQualityTelemetryCard: {
    marginBottom: 10,
  },

  telemetryRow: {
    alignItems: "stretch",
    borderBottomColor: "#123451",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 86,
  },

  telemetryRowDesktop: {
    minHeight: 104,
  },

  telemetryCurrent: {
    flex: 1,
    justifyContent: "center",
    minWidth: 86,
    paddingHorizontal: 11,
  },

  telemetryCurrentDesktop: {
    minWidth: 110,
    paddingHorizontal: 15,
  },

  telemetryDisclosure: {
    alignSelf: "center",
    color: "#20B7EC",
    fontSize: 26,
    fontWeight: "500",
    marginRight: 14,
  },

  telemetryLabel: {
    color: "#8FA4BF",
    fontSize: 10,
    fontWeight: "800",
  },

  telemetryLabelDesktop: {
    fontSize: 13,
  },

  telemetryValueRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 3,
    marginTop: 2,
  },

  telemetryValue: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
  },

  telemetryValueDesktop: {
    fontSize: 30,
  },

  telemetryUnit: {
    color: "#7890AC",
    fontSize: 10,
    fontWeight: "700",
  },

  telemetryUnitDesktop: {
    fontSize: 13,
  },

  telemetryStatus: {
    color: "#55718D",
    fontSize: 9,
  },

  telemetryStatusDesktop: {
    fontSize: 12,
    marginTop: 2,
  },

  measurementPanel: {
    alignItems: "flex-start",
    backgroundColor: "#081F39",
    borderColor: "#153E63",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
    padding: 12,
  },

  measurementPanelDesktop: {
    gap: 8,
    padding: 12,
  },

  measurementGraphButton: {
    alignItems: "center",
    backgroundColor: "#0A2949",
    borderColor: "#20B7EC",
    borderRadius: 15,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 42,
  },

  measurementGraphButtonDesktop: {
    height: 40,
    width: "19%",
  },

  coachSectionTitle: {
    marginTop: 14,
  },

  journalScreen: {
    backgroundColor: "#061528",
    flex: 1,
  },

  journalScreenHeader: {
    alignItems: "center",
    borderBottomColor: "#153E63",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingVertical: 16,
  },

  journalScreenTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
    marginTop: 3,
  },

  journalScreenContent: {
    alignSelf: "center",
    maxWidth: 900,
    padding: 22,
    width: "100%",
  },

  eyebrow: {
    color: "#20B7EC",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },

  tankName: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "700",
    marginTop: 7,
  },

  tankDescription: {
    color: "#A9B7CA",
    fontSize: 15,
    marginTop: 5,
  },

  waterQualityLabel: {
    color: "#8FA4BF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
    marginTop: 22,
  },

  waterMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 11,
  },

  waterMetricGridWide: {
    gap: 8,
    marginTop: 9,
  },

  waterMetricCard: {
    backgroundColor: "#08213D",
    borderColor: "#123E65",
    borderRadius: 15,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: 130,
    paddingHorizontal: 15,
    paddingVertical: 14,
  },

  waterMetricCardWide: {
    flexBasis: "100%",
    minWidth: 0,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },

  waterMetricLabel: {
    color: "#9DB0C6",
    fontSize: 12,
    fontWeight: "700",
  },

  waterMetricValueRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 5,
    marginTop: 5,
    minHeight: 32,
  },

  waterMetricValue: {
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "700",
  },

  waterMetricUnit: {
    color: "#8FA4BF",
    fontSize: 13,
    fontWeight: "600",
  },

  waterMetricStatus: {
    color: "#6F879F",
    fontSize: 11,
    marginTop: 2,
  },

  sectionTitle: {
    color: "#E9F2F5",
    fontSize: 19,
    fontWeight: "700",
    marginBottom: 12,
  },

  sectionTitleDesktop: {
    fontSize: 22,
    marginBottom: 15,
  },

  listCard: {
    backgroundColor: "#08213D",
    borderRadius: 18,
    paddingHorizontal: 17,
    marginBottom: 28,
    overflow: "hidden",
  },

  equipmentRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    paddingHorizontal: 4,
  },

  equipmentRowDesktop: {
    minHeight: 80,
    paddingHorizontal: 7,
  },

  equipmentRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#102F50",
  },

  equipmentRowSelected: {
    backgroundColor: "#0D365D",
  },

  equipmentRowPressed: {
    opacity: 0.75,
  },

  equipmentRowDragging: {
    backgroundColor: "#0D365D",
    elevation: 8,
    opacity: 0.9,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 7,
    transform: [{ scale: 1.015 }],
    zIndex: 2,
  },

  equipmentDragSurface: {
    alignItems: "center",
    alignSelf: "stretch",
    flex: 1,
    flexDirection: "row",
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2ECC71",
    marginRight: 14,
  },

  statusDotOffline: {
    backgroundColor: "#E74C3C",
  },

  equipmentText: {
    flex: 1,
  },

  equipmentName: {
    color: "#F4F8F9",
    fontSize: 16,
    fontWeight: "600",
  },

  equipmentNameDesktop: {
    fontSize: 18,
  },

  equipmentRole: {
    color: "#8298B4",
    fontSize: 12,
    marginTop: 3,
  },

  equipmentRoleDesktop: {
    fontSize: 14,
    marginTop: 4,
  },

  modeControl: {
    backgroundColor: "#061528",
    borderColor: "#164975",
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    marginLeft: 10,
    padding: 2,
  },

  modeControlDesktop: {
    borderRadius: 11,
    padding: 3,
  },

  modeSegment: {
    alignItems: "center",
    borderRadius: 6,
    justifyContent: "center",
    minHeight: 30,
    minWidth: 39,
    paddingHorizontal: 6,
  },

  modeSegmentDesktop: {
    minHeight: 36,
    minWidth: 48,
    paddingHorizontal: 8,
  },

  modeSegmentSelected: {
    borderWidth: 1,
  },

  modeSegmentOff: {
    backgroundColor: "#3B204D",
    borderColor: "#7A35E9",
  },

  modeSegmentAuto: {
    backgroundColor: "#133A67",
    borderColor: "#0A8FEA",
  },

  modeSegmentOn: {
    backgroundColor: "#16453A",
    borderColor: "#28725E",
  },

  modeLabel: {
    color: "#6F7D93",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },

  modeLabelDesktop: {
    fontSize: 11,
  },

  modeLabelSelected: {
    color: "#F1F8F9",
  },

  detailCard: {
    backgroundColor: "#0A2949",
    borderRadius: 18,
    padding: 20,
    marginBottom: 28,
  },

  detailCardModal: {
    marginBottom: 0,
  },

  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },

  detailName: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "700",
  },

  detailNameColumn: {
    flex: 1,
    marginRight: 12,
    minWidth: 0,
  },

  inlineNameDisplay: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },

  aquariumNameText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },

  inlineNameEditor: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },

  inlineNameInput: {
    backgroundColor: "#061528",
    borderColor: "#0A8FEA",
    borderRadius: 9,
    borderWidth: 1,
    color: "#FFFFFF",
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    paddingHorizontal: 11,
    paddingVertical: 8,
  },

  inlineNameAction: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },

  inlineNamePencil: {
    color: "#20B7EC",
    fontSize: 21,
  },

  inlineNameCheck: {
    color: "#2ECC71",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },

  inlineNameCancel: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },

  inlineNameCancelText: {
    color: "#E74C3C",
    fontSize: 24,
    lineHeight: 30,
  },

  detailRole: {
    color: "#8FA4BF",
    fontSize: 13,
    marginTop: 4,
    textTransform: "capitalize",
  },

  detailState: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 11,
    fontWeight: "800",
  },

  detailStateOn: {
    color: "#2ECC71",
    backgroundColor: "#16493F",
  },

  detailStateOff: {
    color: "#E74C3C",
    backgroundColor: "#4A252A",
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#12385F",
  },

  detailLabel: {
    color: "#8FA4BF",
    fontSize: 13,
  },

  detailValue: {
    color: "#E8F0F3",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "capitalize",
  },

  unboundText: {
    color: "#B0C0C6",
    fontSize: 13,
    paddingVertical: 12,
  },

  editorEyebrow: {
    color: "#8FA4BF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 8,
    marginTop: 4,
  },

  nameInput: {
    backgroundColor: "#061528",
    borderColor: "#0A8FEA",
    borderRadius: 12,
    borderWidth: 1,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 20,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },

  roleChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 22,
  },

  roleChoice: {
    backgroundColor: "#0B2E50",
    borderColor: "#0A8FEA",
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },

  roleChoiceSelected: {
    backgroundColor: "#0A8FEA",
    borderColor: "#20B7EC",
  },

  roleChoiceText: {
    color: "#A9B7CA",
    fontSize: 12,
    fontWeight: "700",
  },

  roleChoiceTextSelected: {
    color: "#F2FFFF",
  },

  editorActions: {
    flexDirection: "row",
    gap: 10,
  },

  cancelButton: {
    alignItems: "center",
    borderColor: "#6F7D93",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 13,
  },

  cancelButtonText: {
    color: "#AFC0C6",
    fontWeight: "700",
  },

  saveButton: {
    alignItems: "center",
    backgroundColor: "#0A8FEA",
    borderRadius: 10,
    flex: 2,
    paddingVertical: 13,
  },

  saveButtonText: {
    color: "#EFFFFF",
    fontWeight: "800",
  },

  buttonDisabled: {
    opacity: 0.45,
  },

  editButton: {
    alignItems: "center",
    borderColor: "#20B7EC",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 14,
    paddingVertical: 12,
  },

  editButtonText: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "800",
  },

  closeButton: {
    alignItems: "center",
    backgroundColor: "#0D3B68",
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },

  closeButtonText: {
    color: "#20B7EC",
    fontSize: 13,
    fontWeight: "700",
  },

  coachCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#092E3A",
    borderRadius: 18,
    padding: 18,
  },

  coachCardDesktop: {
    padding: 22,
  },

  coachIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16493F",
    marginRight: 14,
  },

  coachIconText: {
    color: "#2ECC71",
    fontSize: 22,
    fontWeight: "800",
  },

  coachText: {
    flex: 1,
  },

  coachTitle: {
    color: "#F2FAF7",
    fontSize: 16,
    fontWeight: "700",
  },

  coachTitleDesktop: {
    fontSize: 18,
  },

  coachSummary: {
    color: "#8EB4AA",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },

  coachSummaryDesktop: {
    fontSize: 15,
    lineHeight: 22,
  },

  simulationNotice: {
    color: "#6F7D93",
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginTop: 24,
  },
  outletTransferActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  outletTransferButton: { alignItems: "center", borderColor: "#20B7EC", borderRadius: 10, borderWidth: 1, flex: 1, padding: 12 },
  outletTransferButtonText: { color: "#20B7EC", fontSize: 12, fontWeight: "800", textAlign: "center" },
  outletTransferBackdrop: { alignItems: "center", backgroundColor: "rgba(2, 10, 22, 0.86)", flex: 1, justifyContent: "center", padding: 24 },
  outletTransferCard: { backgroundColor: "#08213D", borderColor: "#20B7EC", borderRadius: 18, borderWidth: 1, gap: 11, maxHeight: "88%", maxWidth: 560, padding: 20, width: "100%" },
  outletTransferTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "800" },
  outletTransferSummary: { color: "#A9B7CA", fontSize: 13, lineHeight: 19 },
  outletTransferChoice: { backgroundColor: "#061528", borderColor: "#164975", borderRadius: 10, borderWidth: 1, padding: 12 },
  outletTransferChoices: { gap: 8, paddingRight: 4 },
  outletTransferChoiceScroller: { flexGrow: 0, maxHeight: 320 },
  outletTransferChoiceSelected: { borderColor: "#20B7EC", borderWidth: 2 },
  outletTransferChoiceName: { color: "#F3F7F8", fontSize: 15, fontWeight: "700" },
  outletTransferChoiceConnection: { color: "#8FA4BF", fontSize: 12, marginTop: 3 },
  outletTransferNameInput: { backgroundColor: "#061528", borderColor: "#20B7EC", borderRadius: 10, borderWidth: 1, color: "#FFFFFF", fontSize: 15, paddingHorizontal: 12, paddingVertical: 11 },
  outletTransferMapping: { backgroundColor: "#061528", borderRadius: 10, color: "#DCEAF4", fontSize: 13, lineHeight: 19, padding: 12 },
  outletTransferError: { color: "#FCA5A5", fontSize: 13, lineHeight: 18 },
  outletTransferFooter: { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 5 },
  outletTransferCancel: { borderColor: "#49627A", borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 11 },
  outletTransferCancelText: { color: "#C5D2E2", fontWeight: "700" },
  outletTransferConfirm: { backgroundColor: "#20B7EC", borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 },
  outletTransferConfirmText: { color: "#061528", fontWeight: "900" },
});
