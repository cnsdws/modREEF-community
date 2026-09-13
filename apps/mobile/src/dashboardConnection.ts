import * as SecureStore from "expo-secure-store";
import type {
  AuthorizationAuditEvent,
  AquariumExport,
  AquariumSummary,
  AquariumMember,
  AquariumRole,
  EdgeSummary,
  RoutineDefinitionInput,
  RoutineRuntimeState,
  ReefCoachReport,
  WaterAlarmRules,
  RegisteredEdgeCredentials,
} from "@modreef/api-contract";
import type {
  AdvancedOutletProgram,
  Aquarium,
  AquariumEvent,
  Equipment,
  EquipmentControlMode,
  EquipmentDisplaySetting,
  DoserCalibration,
  DosingParameter,
  EquipmentIntervalProgram,
  EquipmentProgramType,
  EquipmentSchedule,
  EquipmentSpeedSchedule,
  PhysicalDevice,
  WaterMeasurement,
  WaterProbeCalibration,
} from "@modreef/digital-twin";
import { isMeasurementEquipment } from "@modreef/digital-twin";
import {
  FetchModReefTransport,
  ModReefCloudClient,
  ModReefHttpError,
} from "@modreef/cloud-client";
import {
  createAquariumEvent,
  getAquariumEvents,
  getEdgeAquarium,
  getEdgeEquipment,
  setEdgeEquipmentControlMode,
  runEdgeDoserCalibration,
  setEdgeDoserCalibration,
  setEdgeEquipmentIntervalProgram,
  setEdgeAdvancedOutletProgram,
  setEdgeEquipmentSchedule,
  setEdgeEquipmentSpeed,
  setEdgeEquipmentSpeedSchedule,
  setEdgeWavemakerConfiguration,
  setEdgeWaterProbeCalibration,
  updateEdgeAquariumName,
  updateAquariumEvent,
  deleteAquariumEvent,
  updateEdgeEquipment,
  updateEdgeEquipmentDisplay,
  updateEdgeEquipmentLayout,
  setEdgeEquipmentProgramType,
  renameEdgeManagedDevice,
  deleteEdgeManagedDevice,
  getEdgeManagedDevices,
  cloneEdgeEquipmentConfiguration,
  swapEdgeEquipmentBindings,
  authorizeLocalEdgeFromCloud,
  configureEdgeTarget,
  initializeLocalAuthorization,
  unclaimLocalEdge,
  getEdgeFeedMode,
  getEdgeHealth,
  startEdgeFeedMode,
  stopEdgeFeedMode,
  createEdgeRoutine,
  deleteEdgeRoutine,
  finishEdgeRoutine,
  getEdgeRoutines,
  runEdgeRoutine,
  stopEdgeRoutine,
  updateEdgeRoutine,
  type CreateAquariumEventInput,
  type EdgeFeedMode,
} from "./edgeClient";
import { localUrlForHostname } from "./edgeTarget";
import { dashboardConnectionMode } from "./connectionMode";
import { measurementFromEvent } from "./measurementEvents";
import { jsonDocumentsEquivalent } from "./jsonDocuments";
import { edgeIsCurrentlyOnline } from "./cloudDeviceMutation";
import { equipmentWithRequestedControlMode } from "./equipmentControlModeReconciliation";

export { dashboardConnectionMode } from "./connectionMode";

const accessTokenKey = "modreef.cloud.access-token";
const refreshTokenKey = "modreef.cloud.refresh-token";
const aquariumIdKey = "modreef.cloud.aquarium-id";
let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): BrowserStorage | null {
  return (globalThis as { localStorage?: BrowserStorage }).localStorage ?? null;
}

async function getStoredValue(key: string): Promise<string | null> {
  if (await SecureStore.isAvailableAsync()) {
    return SecureStore.getItemAsync(key);
  }

  return browserStorage()?.getItem(key) ?? null;
}

async function setStoredValue(key: string, value: string): Promise<void> {
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  browserStorage()?.setItem(key, value);
}

async function deleteStoredValue(key: string): Promise<void> {
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.deleteItemAsync(key);
    return;
  }

  browserStorage()?.removeItem(key);
}

export class CloudAquariumRequiredError extends Error {
  constructor() {
    super("Create your first cloud aquarium");
    this.name = "CloudAquariumRequiredError";
  }
}

export async function setCloudAccessToken(token: string | null): Promise<void> {
  memoryAccessToken = token;
  if (token) await setStoredValue(accessTokenKey, token);
  else await deleteStoredValue(accessTokenKey);
}

export async function setCloudRefreshToken(token: string | null): Promise<void> {
  memoryRefreshToken = token;
  if (token) await setStoredValue(refreshTokenKey, token);
  else await deleteStoredValue(refreshTokenKey);
}

export async function getCloudRefreshToken(): Promise<string | null> {
  if (memoryRefreshToken) return memoryRefreshToken;
  memoryRefreshToken = await getStoredValue(refreshTokenKey);
  return memoryRefreshToken;
}

export async function clearCloudSession(): Promise<void> {
  await Promise.all([
    setCloudAccessToken(null),
    setCloudRefreshToken(null),
  ]);
}

async function cloudAccessToken(): Promise<string | null> {
  if (memoryAccessToken) return memoryAccessToken;
  memoryAccessToken = await getStoredValue(accessTokenKey);
  return memoryAccessToken;
}

export async function getCloudAccessToken(): Promise<string | null> {
  return cloudAccessToken();
}

export async function validateCloudAccessToken(): Promise<boolean> {
  const token = await cloudAccessToken();
  if (!token) return false;
  try {
    await cloudClient().listAquariums();
    return true;
  } catch (error) {
    if (error instanceof ModReefHttpError && error.status === 401) {
      await setCloudAccessToken(null);
      return false;
    }
    // A network interruption must not destroy an otherwise valid session.
    return true;
  }
}

function cloudClient(): ModReefCloudClient {
  const url = process.env.EXPO_PUBLIC_MODREEF_CLOUD_URL ?? "https://api.modreef.net";
  return new ModReefCloudClient(new FetchModReefTransport(url, cloudAccessToken));
}

function isEquipment(value: unknown): value is Equipment {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.enabled === "boolean";
}

function liveMeasurements(equipment: Equipment[]): WaterMeasurement[] {
  return equipment.flatMap((item) => [
    ...(Array.isArray(item.measurementHistory) ? item.measurementHistory : []),
    ...(Array.isArray(item.liveMeasurements) ? item.liveMeasurements : []),
  ]);
}

function isDashboardEquipment(equipment: Equipment): boolean {
  return !isMeasurementEquipment(equipment);
}

function isAquariumEvent(value: unknown): value is AquariumEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === "string" && typeof event.aquariumId === "string" &&
    typeof event.type === "string" && typeof event.occurredAt === "string" &&
    typeof event.recordedAt === "string" && typeof event.source === "string";
}

async function selectedAquariumId(client: ModReefCloudClient): Promise<string> {
  const stored = await getStoredValue(aquariumIdKey);
  const aquariums = await client.listAquariums();
  const selected = aquariums.find((item) => item.id === stored) ?? aquariums[0];
  if (!selected) throw new CloudAquariumRequiredError();
  await setStoredValue(aquariumIdKey, selected.id);
  return selected.id;
}

export async function createCloudAquarium(name: string): Promise<Aquarium> {
  const client = cloudClient();
  const created = await client.createAquarium(name.trim());
  await setStoredValue(aquariumIdKey, created.id);
  return {
    id: created.id,
    name: created.name,
    description: "",
    displayVolumeGallons: 0,
    systemType: "reef",
    createdAt: created.createdAt,
  };
}

export async function listDashboardAquariums(): Promise<AquariumSummary[]> {
  if (dashboardConnectionMode() !== "cloud") return [];
  return cloudClient().listAquariums();
}

export async function listDashboardAquariumMembers(aquariumId: string): Promise<AquariumMember[]> {
  if (dashboardConnectionMode() !== "cloud") return [];
  return cloudClient().listAquariumMembers(aquariumId);
}

export async function addDashboardAquariumMember(
  aquariumId: string,
  email: string,
  role: Exclude<AquariumRole, "owner">,
): Promise<AquariumMember> {
  return cloudClient().addAquariumMember(aquariumId, email, role);
}

export async function updateDashboardAquariumMember(
  aquariumId: string,
  userId: string,
  update: { role?: Exclude<AquariumRole, "owner">; receiveAlarms?: boolean },
): Promise<AquariumMember> {
  return cloudClient().updateAquariumMember(aquariumId, userId, update);
}

export async function removeDashboardAquariumMember(
  aquariumId: string,
  userId: string,
): Promise<void> {
  await cloudClient().removeAquariumMember(aquariumId, userId);
}

export async function resendDashboardAquariumInvitation(
  aquariumId: string,
  userId: string,
): Promise<AquariumMember> {
  return cloudClient().resendAquariumInvitation(aquariumId, userId);
}

export async function transferDashboardAquariumOwnership(
  aquariumId: string,
  userId: string,
): Promise<AquariumMember[]> {
  return cloudClient().transferAquariumOwnership(aquariumId, userId);
}

export async function listDashboardAuthorizationAudit(
  aquariumId: string,
): Promise<AuthorizationAuditEvent[]> {
  return cloudClient().listAuthorizationAudit(aquariumId);
}

export async function exportDashboardAquarium(aquariumId: string): Promise<AquariumExport> {
  return cloudClient().exportAquarium(aquariumId);
}

export async function deleteDashboardAccount(): Promise<void> {
  await cloudClient().deleteAccount();
}

/** Device identities already assigned to any aquarium visible to this user. */
export async function listAssignedDashboardDeviceIds(): Promise<string[]> {
  if (dashboardConnectionMode() === "local") {
    return (await getEdgeManagedDevices()).map(({ id }) => id);
  }

  const client = cloudClient();
  const aquariums = await client.listAquariums();
  const snapshots = await Promise.all(
    aquariums.map(({ id }) => client.listDevices(id)),
  );
  return [...new Set(
    snapshots.flat().map(({ deviceId }) => deviceId),
  )];
}

export async function listArchivedDashboardAquariums(): Promise<AquariumSummary[]> {
  if (dashboardConnectionMode() !== "cloud") return [];
  return cloudClient().listArchivedAquariums();
}

export async function archiveDashboardAquarium(aquariumId: string): Promise<AquariumSummary> {
  if (dashboardConnectionMode() !== "cloud") {
    throw new Error("Tank archival requires a cloud connection.");
  }
  const archived = await cloudClient().archiveAquarium(aquariumId);
  const selected = await getStoredValue(aquariumIdKey);
  if (selected === aquariumId) await deleteStoredValue(aquariumIdKey);
  return archived;
}

export async function restoreDashboardAquarium(aquariumId: string): Promise<AquariumSummary> {
  if (dashboardConnectionMode() !== "cloud") {
    throw new Error("Tank restoration requires a cloud connection.");
  }
  return cloudClient().restoreAquarium(aquariumId);
}

export async function analyzeDashboardReefCoach(): Promise<ReefCoachReport> {
  if (dashboardConnectionMode() !== "cloud") {
    throw new Error("Model analysis requires a cloud connection.");
  }
  const client = cloudClient();
  return client.analyzeReefCoach(await selectedAquariumId(client));
}

export async function loadSharedWaterAlarmRules(
  aquariumId: string,
  localFallback: WaterAlarmRules,
): Promise<WaterAlarmRules> {
  if (dashboardConnectionMode() !== "cloud") return localFallback;
  const client = cloudClient();
  const settings = await client.getWaterAlarmSettings(aquariumId);
  if (settings) return settings.rules;
  return (await client.saveWaterAlarmSettings(aquariumId, localFallback)).rules;
}

export async function saveSharedWaterAlarmRules(
  aquariumId: string,
  rules: WaterAlarmRules,
): Promise<WaterAlarmRules> {
  if (dashboardConnectionMode() !== "cloud") return rules;
  return (await cloudClient().saveWaterAlarmSettings(aquariumId, rules)).rules;
}

export async function selectDashboardAquarium(aquariumId: string): Promise<void> {
  const client = cloudClient();
  const aquariums = await client.listAquariums();
  if (!aquariums.some((aquarium) => aquarium.id === aquariumId)) {
    throw new Error("Aquarium is not available for this account");
  }
  await setStoredValue(aquariumIdKey, aquariumId);
}

export async function selectDashboardAquariumWithController(
  preferredAquariumId?: string | null,
  excludedAquariumId?: string | null,
): Promise<AquariumSummary | null> {
  const client = cloudClient();
  const aquariums = await client.listAquariums();
  const candidates = [
    ...aquariums.filter(
      (aquarium) =>
        aquarium.id === preferredAquariumId &&
        aquarium.id !== excludedAquariumId,
    ),
    ...aquariums.filter(
      (aquarium) =>
        aquarium.id !== preferredAquariumId &&
        aquarium.id !== excludedAquariumId,
    ),
  ];

  for (const aquarium of candidates) {
    if ((await client.listEdges(aquarium.id)).length > 0) {
      await setStoredValue(aquariumIdKey, aquarium.id);
      return aquarium;
    }
  }

  return null;
}

export interface DashboardData {
  aquarium: Aquarium;
  controllers: EdgeSummary[];
  equipment: Equipment[];
  devices: PhysicalDevice[];
  deviceControllerIds: Record<string, string>;
  controllerNames: Record<string, string>;
  controllerIds: Record<string, string>;
  edgeOnline: boolean;
  edgeRegistered: boolean;
  measurements: WaterMeasurement[];
  events: AquariumEvent[];
  waterQualitySensor?: Equipment;
}

let localMeasurements: WaterMeasurement[] = [];
let localEvents: AquariumEvent[] = [];
let localMeasurementsRefresh: Promise<void> | null = null;

function refreshLocalMeasurements(aquariumId: string): void {
  if (localMeasurementsRefresh) return;

  localMeasurementsRefresh = getAquariumEvents(1000)
    .then((events) => {
      localEvents = events;
      localMeasurements = events.map((event) =>
        measurementFromEvent(event, aquariumId)
      ).filter(
        (measurement): measurement is WaterMeasurement => measurement !== null,
      );
    })
    .catch(() => {
      // Equipment inventory and control must remain available when history is unavailable.
    })
    .finally(() => {
      localMeasurementsRefresh = null;
    });
}

export async function getDashboardData(): Promise<DashboardData> {
  if (dashboardConnectionMode() === "local") {
    const [aquarium, equipment, devices] = await Promise.all([
      getEdgeAquarium(), getEdgeEquipment(), getEdgeManagedDevices(),
    ]);
    const sensorMeasurements = liveMeasurements(equipment);
    const dashboardEquipment = equipment.filter(isDashboardEquipment);
    refreshLocalMeasurements(aquarium.id);
    return {
      aquarium,
      controllers: [],
      devices: devices.map((device) => ({
        ...device,
        aquariumId: aquarium.id,
        manufacturer: device.manufacturer ?? "",
        model: device.model ?? "",
        driverId: "",
        connectionStatus: "unknown" as const,
        createdAt: "",
      })),
      deviceControllerIds: {},
      equipment: dashboardEquipment,
      controllerNames: Object.fromEntries(
        dashboardEquipment.map((item) => [item.id, "Reef Controller"]),
      ),
      controllerIds: {},
      measurements: [...localMeasurements, ...sensorMeasurements],
      events: localEvents,
      ...(equipment.find(isMeasurementEquipment)
        ? { waterQualitySensor: equipment.find(isMeasurementEquipment)! }
        : {}),
      edgeOnline: true,
      edgeRegistered: true,
    };
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const summaries = await client.listAquariums();
  const summary = summaries.find((item) => item.id === aquariumId)!;
  const [snapshots, deviceSnapshots, edges, events] = await Promise.all([
    client.listEquipment(aquariumId), client.listDevices(aquariumId),
    client.listEdges(aquariumId), client.listEvents(aquariumId),
  ]);
  const edgeNames = new Map(edges.map((edge) => [edge.id, edge.name]));
  const aquariumEvents = events
    .map((event) => event.document)
    .filter(isAquariumEvent);
  const equipment = snapshots.map((item) => item.document).filter(isEquipment).map(
    (item) => ({ ...item, aquariumId }),
  );
  return {
    aquarium: { id: summary.id, name: summary.name, description: "", displayVolumeGallons: 0, systemType: "reef", createdAt: summary.createdAt },
    controllers: edges,
    devices: deviceSnapshots.map(({ document }) => ({ ...document, aquariumId })),
    deviceControllerIds: Object.fromEntries(
      deviceSnapshots.map((snapshot) => [snapshot.deviceId, snapshot.edgeId]),
    ),
    equipment: equipment.filter(isDashboardEquipment),
    controllerNames: Object.fromEntries(
      snapshots.map((snapshot) => [
        snapshot.equipmentId,
        edgeNames.get(snapshot.edgeId) ?? "Reef Controller",
      ]),
    ),
    controllerIds: Object.fromEntries(
      snapshots.map((snapshot) => [snapshot.equipmentId, snapshot.edgeId]),
    ),
    measurements: [
      ...aquariumEvents.map((event) => measurementFromEvent(event, aquariumId)).filter(
        (measurement): measurement is WaterMeasurement => measurement !== null,
      ),
      ...liveMeasurements(equipment),
    ],
    events: aquariumEvents,
    ...(equipment.find(isMeasurementEquipment)
      ? { waterQualitySensor: equipment.find(isMeasurementEquipment)! }
      : {}),
    edgeRegistered: edges.length > 0,
    edgeOnline: edges.some((edge) => {
      const lastSeen = edge.lastSeenAt ? Date.parse(edge.lastSeenAt) : Number.NaN;
      return edge.status === "online" && Number.isFinite(lastSeen) && Date.now() - lastSeen < 60_000;
    }),
  };
}

export async function waitForDashboardDevice(
  deviceId: string,
  timeoutMilliseconds = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const found = dashboardConnectionMode() === "local"
      ? (await getEdgeManagedDevices()).some((device) => device.id === deviceId)
      : await (async () => {
          const client = cloudClient();
          const aquariumId = await selectedAquariumId(client);
          return (await client.listDevices(aquariumId)).some(
            (snapshot) => snapshot.deviceId === deviceId,
          );
        })();
    if (found) return;
    await delay(500);
  }
  throw new Error(
    "The Reef Controller saved the device, but it did not appear in the aquarium inventory within 15 seconds.",
  );
}

export async function setDashboardWaterProbeCalibration(
  equipment: Equipment,
  calibration: WaterProbeCalibration,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeWaterProbeCalibration(equipment.id, calibration);
  }
  return sendEquipmentConfigurationCommand(
    equipment.id,
    "equipment.set-water-calibration",
    { calibration },
    (reported) => JSON.stringify(reported.waterProbeCalibration) === JSON.stringify(calibration),
    "water probe calibration",
  );
}

export async function getDashboardEvents(limit = 100): Promise<AquariumEvent[]> {
  if (dashboardConnectionMode() === "local") return getAquariumEvents(limit);
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  return (await client.listEvents(aquariumId))
    .map((event) => event.document)
    .filter(isAquariumEvent)
    .slice(0, limit);
}

export async function createDashboardEvent(
  input: CreateAquariumEventInput,
): Promise<AquariumEvent> {
  if (dashboardConnectionMode() === "local") return createAquariumEvent(input);
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const edges = await client.listEdges(aquariumId);
  const edge = edges.find((candidate) => candidate.status === "online") ?? edges[0];
  if (!edge) throw new Error("No Reef Controller is registered for this aquarium");

  const eventId = `event-${commandId()}`;
  await client.createCommand(aquariumId, {
    commandId: commandId(),
    edgeId: edge.id,
    equipmentId: "aquarium",
    type: "aquarium.event.create",
    payload: { eventId, event: input },
  });

  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const confirmed = (await client.listEvents(aquariumId))
      .map((event) => event.document)
      .filter(isAquariumEvent)
      .find((event) => event.id === eventId);
    if (confirmed) return confirmed;
  }

  throw new Error("The Reef Controller did not confirm the journal entry within 30 seconds");
}

async function commandEdge(client: ModReefCloudClient, aquariumId: string) {
  const edges = await client.listEdges(aquariumId);
  const edge = edges.find((candidate) => candidate.status === "online") ?? edges[0];
  if (!edge) throw new Error("No Reef Controller is registered for this aquarium");
  return edge;
}

export async function getDashboardRoutines(
  edgeId?: string,
): Promise<RoutineRuntimeState> {
  if (dashboardConnectionMode() === "local") {
    const state = await getEdgeRoutines();
    return { definitions: state.routines, active: state.active };
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const edges = await client.listEdges(aquariumId);
  const edge = edgeId
    ? edges.find((candidate) => candidate.id === edgeId)
    : edges.find((candidate) => candidate.status === "online") ?? edges[0];
  if (!edge) throw new Error("No Reef Controller is registered for this aquarium");
  return edge.runtimeState.routines ?? { definitions: [], active: null };
}

async function sendDashboardRoutineCommand(
  edgeId: string,
  type: string,
  payload: Record<string, unknown>,
  confirmedState?: (state: RoutineRuntimeState) => boolean,
): Promise<void> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  await requireOnlineOwningEdge(client, aquariumId, edgeId);
  const command = await client.createCommand(aquariumId, {
    commandId: commandId(),
    edgeId,
    equipmentId: "routines",
    type,
    payload,
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    const outcome = await client.getCommand(aquariumId, command.commandId);
    if (outcome.status === "completed") {
      if (!confirmedState) {
        // Command results and the next runtime-state heartbeat are separate
        // sync cycles. Give the controller time to publish its new state.
        await delay(500);
        return;
      }
      const edge = (await client.listEdges(aquariumId))
        .find((candidate) => candidate.id === edgeId);
      const state = edge?.runtimeState.routines;
      if (state && confirmedState(state)) return;
    }
    if (outcome.status === "failed") {
      throw new Error(outcome.message ?? "The Reef Controller rejected the routine command.");
    }
    await delay(cloudCommandConfirmationPollMilliseconds);
  }
  throw new Error("The Reef Controller did not confirm the routine command within 30 seconds.");
}

export async function createDashboardRoutine(
  edgeId: string,
  input: RoutineDefinitionInput,
): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await createEdgeRoutine(input);
    return;
  }
  await sendDashboardRoutineCommand(
    edgeId,
    "routine.create",
    { input },
    (state) => state.definitions.some(
      (routine) => routine.name === input.name.trim() &&
        Date.parse(routine.updatedAt) >= Date.now() - 30_000,
    ),
  );
}

export async function updateDashboardRoutine(
  edgeId: string,
  routineId: string,
  input: RoutineDefinitionInput,
): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await updateEdgeRoutine(routineId, input);
    return;
  }
  await sendDashboardRoutineCommand(
    edgeId,
    "routine.update",
    { routineId, input },
    (state) => state.definitions.some(
      (routine) => routine.id === routineId &&
        routine.name === input.name.trim() &&
        JSON.stringify(routine.tasks) === JSON.stringify(input.tasks),
    ),
  );
}

export async function deleteDashboardRoutine(
  edgeId: string,
  routineId: string,
): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await deleteEdgeRoutine(routineId);
    return;
  }
  await sendDashboardRoutineCommand(
    edgeId,
    "routine.delete",
    { routineId },
    (state) => !state.definitions.some((routine) => routine.id === routineId),
  );
}

export async function runDashboardRoutine(
  edgeId: string,
  routineId: string,
): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await runEdgeRoutine(routineId);
    return;
  }
  await sendDashboardRoutineCommand(edgeId, "routine.run", { routineId });
}

export async function stopDashboardRoutine(edgeId: string): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await stopEdgeRoutine();
    return;
  }
  await sendDashboardRoutineCommand(
    edgeId,
    "routine.stop",
    {},
    (state) => state.active === null,
  );
}

export async function finishDashboardRoutine(edgeId: string): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await finishEdgeRoutine();
    return;
  }
  await sendDashboardRoutineCommand(
    edgeId,
    "routine.finish",
    {},
    (state) => state.active?.holding !== true,
  );
}

export async function updateDashboardEvent(
  eventId: string,
  input: CreateAquariumEventInput,
): Promise<AquariumEvent> {
  if (dashboardConnectionMode() === "local") return updateAquariumEvent(eventId, input);
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const edge = await commandEdge(client, aquariumId);
  await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId: edge.id, equipmentId: "aquarium",
    type: "aquarium.event.update", payload: { eventId, event: input },
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const confirmed = (await getDashboardEvents(1000)).find((event) => event.id === eventId);
    if (confirmed && Object.entries(input).every(([key, value]) =>
      JSON.stringify((confirmed as unknown as Record<string, unknown>)[key]) === JSON.stringify(value)
    )) return confirmed;
  }
  throw new Error("The Reef Controller did not confirm the journal update within 30 seconds");
}

export async function deleteDashboardEvent(eventId: string): Promise<void> {
  if (dashboardConnectionMode() === "local") return deleteAquariumEvent(eventId);
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const edge = await commandEdge(client, aquariumId);
  await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId: edge.id, equipmentId: "aquarium",
    type: "aquarium.event.delete", payload: { eventId },
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    if (!(await getDashboardEvents(1000)).some((event) => event.id === eventId)) return;
  }
  throw new Error("The Reef Controller did not confirm the journal deletion within 30 seconds");
}

export async function registerCloudEdge(
  name: string,
): Promise<RegisteredEdgeCredentials> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  return client.registerEdge(aquariumId, name.trim());
}

export async function removeUnconfirmedCloudEdgesExcept(edgeId: string): Promise<void> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const abandoned = (await client.listEdges(aquariumId)).filter(
    (edge) => edge.id !== edgeId && edge.status === "provisioning" && edge.lastSeenAt === null,
  );
  await Promise.all(abandoned.map((edge) => client.removeEdge(aquariumId, edge.id)));
}

export async function removeCloudEdge(edgeId: string, aquariumId?: string): Promise<void> {
  const client = cloudClient();
  const targetAquariumId = aquariumId ?? await selectedAquariumId(client);
  try {
    await client.removeEdge(targetAquariumId, edgeId);
  } catch (error) {
    // Controller retirement is intentionally idempotent. A prior attempt can
    // unclaim the physical Edge and retire its cloud row before the UI refreshes.
    // Treat only that already-absent result as success; authorization failures
    // and inventory blockers must still reach the user.
    if (error instanceof ModReefHttpError && error.status === 404) return;
    throw error;
  }
}

export async function removeDashboardController(edge: EdgeSummary): Promise<void> {
  if (dashboardConnectionMode() !== "cloud") {
    throw new Error("Controller removal requires a cloud connection.");
  }
  const address = edge.localAddress ?? edge.localHostname;
  if (!address) {
    throw new Error(`${edge.name} has not reported a local network address.`);
  }
  const url = localUrlForHostname(address);
  await configureEdgeTarget({ edgeId: edge.id, name: edge.name, url });
  const health = await getEdgeHealth();
  // The local controller identity is authoritative. A failed or interrupted
  // reprovision can leave a cloud card carrying an older Edge id even though
  // it still points at the correct controller address. Switch authorization
  // and retirement to the identity reported by that physical controller.
  const targetEdgeId = health.edgeId ?? edge.id;
  const targetAquariumId = health.aquariumId ?? edge.aquariumId;
  if (targetEdgeId !== edge.id) {
    await configureEdgeTarget({ edgeId: targetEdgeId, name: edge.name, url });
  }
  if (health.claimed !== false) {
    if (!(await initializeLocalAuthorization())) {
      const authorization = await createCloudLocalAuthorization(targetEdgeId, targetAquariumId);
      await authorizeLocalEdgeFromCloud(url, authorization.grant);
    }
    // The Edge is authoritative for device ownership. It refuses this operation
    // until every physical device and equipment channel has been removed.
    await unclaimLocalEdge();
  }
  // Retrying after a network interruption is safe: an already-unclaimed Edge
  // skips the local step and finishes retirement of the stale cloud record.
  await removeCloudEdge(targetEdgeId, targetAquariumId);
}

async function requireOnlineOwningEdge(
  client: ModReefCloudClient,
  aquariumId: string,
  edgeId: string,
): Promise<EdgeSummary> {
  const edge = (await client.listEdges(aquariumId)).find((item) => item.id === edgeId);
  if (!edge) throw new Error("The owning Reef Controller is no longer registered.");
  if (!edgeIsCurrentlyOnline(edge)) {
    throw new Error(`${edge.name} is offline. Reconnect it before changing this device.`);
  }
  return edge;
}

export async function renameDashboardManagedDevice(
  edgeId: string,
  deviceId: string,
  name: string,
): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await renameEdgeManagedDevice(deviceId, name);
    return;
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const edge = await requireOnlineOwningEdge(client, aquariumId, edgeId);
  await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId, equipmentId: deviceId,
    type: "managed-device.rename", payload: { deviceId, name: name.trim() },
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const device = (await client.listDevices(aquariumId)).find(
      (snapshot) => snapshot.edgeId === edgeId && snapshot.deviceId === deviceId,
    );
    if (device?.document.name === name.trim()) return;
  }
  throw new Error(`${edge.name} did not confirm the device name within 30 seconds.`);
}

export async function deleteDashboardManagedDevice(
  edgeId: string,
  deviceId: string,
): Promise<void> {
  if (dashboardConnectionMode() === "local") {
    await deleteEdgeManagedDevice(deviceId);
    return;
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const edge = await requireOnlineOwningEdge(client, aquariumId, edgeId);
  await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId, equipmentId: deviceId,
    type: "managed-device.delete", payload: { deviceId },
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const remains = (await client.listDevices(aquariumId)).some(
      (snapshot) => snapshot.edgeId === edgeId && snapshot.deviceId === deviceId,
    );
    if (!remains) return;
  }
  throw new Error(`${edge.name} did not confirm device removal within 30 seconds.`);
}

export async function cloneDashboardEquipmentConfiguration(
  sourceEquipmentId: string,
  destinationEquipmentId: string,
  name: string,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return cloneEdgeEquipmentConfiguration(
      sourceEquipmentId, destinationEquipmentId, name,
    );
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const snapshots = await client.listEquipment(aquariumId);
  const source = snapshots.find(({ equipmentId }) => equipmentId === sourceEquipmentId);
  const destination = snapshots.find(
    ({ equipmentId }) => equipmentId === destinationEquipmentId,
  );
  if (!source || !destination || source.edgeId !== destination.edgeId) {
    throw new Error("Both outlets must belong to the same Reef Controller.");
  }
  const trimmedName = name.trim();
  const command = await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId: source.edgeId,
    equipmentId: sourceEquipmentId,
    type: "equipment.clone-configuration",
    payload: { destinationEquipmentId, name: trimmedName },
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const outcome = await client.getCommand(aquariumId, command.commandId);
    if (outcome.status === "failed") {
      throw new Error(outcome.message ?? "The Reef Controller rejected the cloned configuration.");
    }
    const reportedSnapshot = (await client.listEquipment(aquariumId)).find(
      ({ equipmentId }) => equipmentId === destinationEquipmentId,
    );
    const reported = reportedSnapshot?.document;
    if (
      outcome.status === "completed" &&
      isEquipment(source.document) && isEquipment(reported) &&
      reportedSnapshot && Date.parse(reportedSnapshot.reportedAt) >= Date.parse(command.createdAt) &&
      reported.name === trimmedName &&
      reported.role === source.document.role &&
      reported.programType === source.document.programType
    ) {
      return { ...reported, aquariumId };
    }
  }
  throw new Error("The Reef Controller did not confirm the cloned configuration.");
}

export async function swapDashboardEquipmentBindings(
  equipmentId: string,
  otherEquipmentId: string,
): Promise<Equipment[]> {
  if (dashboardConnectionMode() === "local") {
    return swapEdgeEquipmentBindings(equipmentId, otherEquipmentId);
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const snapshots = await client.listEquipment(aquariumId);
  const first = snapshots.find((item) => item.equipmentId === equipmentId);
  const second = snapshots.find((item) => item.equipmentId === otherEquipmentId);
  if (!first || !second || first.edgeId !== second.edgeId ||
      !isEquipment(first.document) || !isEquipment(second.document)) {
    throw new Error("Both outlets must belong to the same Reef Controller.");
  }
  const firstConnection = first.document.physicalConnectionId;
  const secondConnection = second.document.physicalConnectionId;
  const command = await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId: first.edgeId, equipmentId,
    type: "equipment.swap-binding", payload: { otherEquipmentId },
  });
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const outcome = await client.getCommand(aquariumId, command.commandId);
    if (outcome.status === "failed") {
      throw new Error(outcome.message ?? "The Reef Controller rejected the outlet swap.");
    }
    const current = await client.listEquipment(aquariumId);
    const updatedFirstSnapshot = current.find((item) => item.equipmentId === equipmentId);
    const updatedSecondSnapshot = current.find((item) => item.equipmentId === otherEquipmentId);
    const updatedFirst = updatedFirstSnapshot?.document;
    const updatedSecond = updatedSecondSnapshot?.document;
    if (outcome.status === "completed" &&
        updatedFirstSnapshot && updatedSecondSnapshot &&
        Date.parse(updatedFirstSnapshot.reportedAt) >= Date.parse(command.createdAt) &&
        Date.parse(updatedSecondSnapshot.reportedAt) >= Date.parse(command.createdAt) &&
        isEquipment(updatedFirst) && isEquipment(updatedSecond) &&
        updatedFirst.physicalConnectionId === secondConnection &&
        updatedSecond.physicalConnectionId === firstConnection) {
      return [
        { ...updatedFirst, aquariumId },
        { ...updatedSecond, aquariumId },
      ];
    }
  }
  throw new Error("The Reef Controller did not confirm the outlet swap.");
}

export async function reprovisionCloudEdge(edgeId: string): Promise<RegisteredEdgeCredentials> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  return client.reprovisionEdge(aquariumId, edgeId);
}

export async function createCloudLocalAuthorization(
  edgeId: string,
  aquariumId?: string,
): Promise<{ grant: string; expiresAt: string }> {
  const client = cloudClient();
  const targetAquariumId = aquariumId ?? await selectedAquariumId(client);
  return client.createLocalAuthorization(targetAquariumId, edgeId);
}

export async function renameCloudEdge(edgeId: string, name: string): Promise<EdgeSummary> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  return client.renameEdge(aquariumId, edgeId, name.trim());
}

export async function requestDashboardControllerUpdate(edgeId: string): Promise<void> {
  if (dashboardConnectionMode() !== "cloud") {
    throw new Error("Controller software updates require a cloud-connected Reef Controller");
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  await client.createCommand(aquariumId, {
    commandId: commandId(), edgeId, equipmentId: edgeId,
    type: "controller.check-for-update", payload: {},
  });
}

export async function setDashboardControllerReleaseChannel(
  edgeId: string,
  channel: "production" | "staging",
): Promise<void> {
  if (dashboardConnectionMode() !== "cloud") {
    throw new Error("Controller release channels require a cloud-connected Reef Controller");
  }
  await sendConfirmedControllerCommand(
    edgeId,
    "controller.set-release-channel",
    { channel },
    "release channel change",
  );
  await requestDashboardControllerUpdate(edgeId);
}

function commandId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const cloudCommandConfirmationTimeoutMilliseconds = 30_000;
const cloudCommandConfirmationPollMilliseconds = 300;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendConfirmedControllerCommand(
  edgeId: string,
  type: string,
  payload: Record<string, unknown>,
  description = "Feed Cycle",
): Promise<void> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const request = {
    commandId: commandId(), edgeId, equipmentId: "feed-cycle", type, payload,
  };
  let command = await client.createCommand(aquariumId, request);
  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    if (command.status === "completed") return;
    if (command.status === "failed") throw new Error(`The Reef Controller rejected the ${description}`);
    await delay(cloudCommandConfirmationPollMilliseconds);
    command = await client.createCommand(aquariumId, request);
  }
  throw new Error(`The Reef Controller did not confirm the ${description} within 30 seconds`);
}

export async function getDashboardFeedMode(): Promise<EdgeFeedMode | null> {
  if (dashboardConnectionMode() === "cloud") return null;
  try {
    return await getEdgeFeedMode();
  } catch {
    return null;
  }
}

export async function startDashboardFeedMode(
  edgeIds: string[],
  durationSeconds: number,
  skimmerRestartDelaySeconds: number,
  cycleId?: "A" | "B" | "C",
): Promise<EdgeFeedMode> {
  if (edgeIds.length === 0) throw new Error("Add a Reef Controller before starting a Feed Cycle");
  const startedAt = new Date();
  const startedEdges: string[] = [];
  try {
    for (const edgeId of edgeIds) {
      if (dashboardConnectionMode() === "local") {
        await startEdgeFeedMode(durationSeconds, skimmerRestartDelaySeconds, cycleId);
      } else {
        await sendConfirmedControllerCommand(edgeId, "automation.feed-cycle.start", {
          durationSeconds, skimmerRestartDelaySeconds, ...(cycleId ? { cycleId } : {}),
        });
      }
      startedEdges.push(edgeId);
    }
  } catch (error) {
    await Promise.allSettled(startedEdges.map((edgeId) =>
      sendConfirmedControllerCommand(edgeId, "automation.feed-cycle.stop", {})
    ));
    throw error;
  }
  return {
    id: `cloud-feed-${startedAt.getTime()}`,
    intent: "feed-mode",
    startedAt: startedAt.toISOString(),
    endsAt: new Date(startedAt.getTime() + durationSeconds * 1_000).toISOString(),
    durationSeconds,
    ...(cycleId ? { cycleId } : {}),
    actions: [],
    phase: "feeding",
  };
}

export async function stopDashboardFeedMode(
  edgeIds: string[],
): Promise<EdgeFeedMode | null> {
  if (edgeIds.length === 0) throw new Error("No Reef Controller is available for this Feed Cycle");
  for (const edgeId of edgeIds) {
    if (dashboardConnectionMode() === "local") await stopEdgeFeedMode();
    else await sendConfirmedControllerCommand(edgeId, "automation.feed-cycle.stop", {});
  }
  // Recovery state is controller-owned and will arrive through runtimeState.
  // Do not fabricate a client countdown: a cycle with no active skimmer has
  // no recovery delay at all.
  return null;
}

export async function setDashboardEquipmentControlMode(
  equipment: Equipment,
  mode: EquipmentControlMode,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return equipmentWithRequestedControlMode(
      await setEdgeEquipmentControlMode(equipment.id, mode),
      mode,
    );
  }
  return sendEquipmentConfigurationCommand(
    equipment.id,
    "equipment.set-control-mode",
    { mode },
    (reported) =>
      (mode === "auto" || reported.enabled === (mode === "on")) &&
      reported.controlMode === mode,
    `${mode.toUpperCase()} control mode`,
  );
}

export async function setDashboardWavemakerConfiguration(
  equipment: Equipment,
  feedCycleParticipation: boolean,
  linkRole: "independent" | "master" | "slave",
  mode: "M1" | "M2" | "M3" | "M4" | "M5",
  modeSettings?: Equipment["wavemakerModeSettings"],
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeWavemakerConfiguration(
      equipment.id, feedCycleParticipation, linkRole, mode, modeSettings,
    );
  }
  return sendEquipmentConfigurationCommand(
    equipment.id,
    "equipment.set-wavemaker-configuration",
    { feedCycleParticipation, linkRole, mode, modeSettings },
    (reported) =>
      reported.feedCycleParticipation === feedCycleParticipation &&
      reported.wavemakerLinkRole === linkRole &&
      reported.wavemakerMode === mode &&
      (modeSettings === undefined || JSON.stringify(reported.wavemakerModeSettings) === JSON.stringify(modeSettings)),
    "wavemaker configuration",
  );
}

export async function updateDashboardAquariumName(name: string): Promise<Aquarium> {
  if (dashboardConnectionMode() === "local") return updateEdgeAquariumName(name);
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const summary = await client.renameAquarium(aquariumId, name.trim());
  return {
    id: summary.id,
    name: summary.name,
    description: "",
    displayVolumeGallons: 0,
    systemType: "reef",
    createdAt: summary.createdAt,
  };
}

export async function updateDashboardEquipment(
  equipmentId: string,
  name: string,
  role: Equipment["role"],
  automaticRestartDelaySeconds?: number,
  dosingParameter?: DosingParameter,
  dosingParameterName?: string,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return updateEdgeEquipment(
      equipmentId, name, role, automaticRestartDelaySeconds,
      dosingParameter,
      dosingParameterName,
    );
  }
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const snapshot = (await client.listEquipment(aquariumId)).find(
    (item) => item.equipmentId === equipmentId,
  );
  if (!snapshot) throw new Error(`Cloud equipment not found: ${equipmentId}`);

  await client.createCommand(aquariumId, {
    commandId: commandId(),
    edgeId: snapshot.edgeId,
    equipmentId,
    type: "equipment.update-configuration",
    payload: {
      name,
      role,
      ...(automaticRestartDelaySeconds === undefined
        ? {}
        : { automaticRestartDelaySeconds }),
      ...(dosingParameter === undefined ? {} : { dosingParameter }),
      ...(dosingParameterName === undefined ? {} : { dosingParameterName }),
    },
  });

  const deadline =
    Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const reported = (await client.listEquipment(aquariumId)).find(
      (item) => item.equipmentId === equipmentId,
    )?.document;
    if (
      isEquipment(reported) &&
      reported.name === name &&
      reported.role === role
      && (automaticRestartDelaySeconds === undefined ||
        reported.automaticRestartDelaySeconds ===
          automaticRestartDelaySeconds)
      && (dosingParameter === undefined ||
        reported.dosingParameter === dosingParameter)
      && (dosingParameterName === undefined ||
        reported.dosingParameterName === dosingParameterName)
    ) {
      return { ...reported, aquariumId };
    }
  }

  throw new Error(
    dosingParameter !== undefined
      ? `${name} did not confirm its dosing category within 30 seconds. Update the Reef Controller and try again.`
      : automaticRestartDelaySeconds === undefined
        ? `${name} did not confirm its updated name within 30 seconds`
        : `${name} did not confirm its automatic restart delay within 30 seconds. Update the Reef Controller and try again.`,
  );
}

export async function updateDashboardEquipmentDisplay(
  equipmentId: string,
  displayOrder: number,
  hiddenFromDashboard: boolean,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return updateEdgeEquipmentDisplay(equipmentId, displayOrder, hiddenFromDashboard);
  }
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.update-display",
    { displayOrder, hiddenFromDashboard },
    (equipment) => equipment.displayOrder === displayOrder &&
      equipment.hiddenFromDashboard === hiddenFromDashboard,
    "its display layout",
  );
}

export async function updateDashboardEquipmentLayout(
  settings: EquipmentDisplaySetting[],
): Promise<Equipment[]> {
  if (dashboardConnectionMode() === "local") {
    return updateEdgeEquipmentLayout(settings);
  }
  if (settings.length === 0) return [];
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const snapshots = await client.listEquipment(aquariumId);
  const edgeByEquipment = new Map(
    snapshots.map((snapshot) => [snapshot.equipmentId, snapshot.edgeId]),
  );
  const settingsByEdge = new Map<string, EquipmentDisplaySetting[]>();
  for (const setting of settings) {
    const edgeId = edgeByEquipment.get(setting.equipmentId);
    if (!edgeId) throw new Error(`Cloud equipment not found: ${setting.equipmentId}`);
    settingsByEdge.set(edgeId, [...(settingsByEdge.get(edgeId) ?? []), setting]);
  }
  const results = await Promise.all([...settingsByEdge].map(async ([edgeId, edgeSettings]) => {
    const command = await client.createCommand(aquariumId, {
      commandId: commandId(), edgeId,
      equipmentId: edgeSettings[0]!.equipmentId,
      type: "equipment.update-layout", payload: { settings: edgeSettings },
    });
    const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
    while (Date.now() < deadline) {
      await delay(cloudCommandConfirmationPollMilliseconds);
      const outcome = await client.getCommand(aquariumId, command.commandId);
      if (outcome.status === "failed") {
        throw new Error(outcome.message ?? "The Reef Controller rejected the equipment layout.");
      }
      const current = await client.listEquipment(aquariumId);
      const updated = edgeSettings.map((setting) => current.find(
        ({ equipmentId }) => equipmentId === setting.equipmentId,
      ));
      if (outcome.status === "completed" && updated.every((snapshot, index) => {
        const expected = edgeSettings[index]!;
        return snapshot && Date.parse(snapshot.reportedAt) >= Date.parse(command.createdAt) &&
          isEquipment(snapshot.document) &&
          snapshot.document.displayOrder === expected.displayOrder &&
          Boolean(snapshot.document.hiddenFromDashboard) === expected.hiddenFromDashboard;
      })) {
        return updated.map((snapshot) => ({
          ...(snapshot!.document as Equipment), aquariumId,
        }));
      }
    }
    throw new Error("The Reef Controller did not confirm the equipment layout.");
  }));
  return results.flat();
}

export async function setDashboardEquipmentProgramType(
  equipmentId: string,
  programType: EquipmentProgramType,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeEquipmentProgramType(equipmentId, programType);
  }

  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const snapshot = (await client.listEquipment(aquariumId)).find(
    (item) => item.equipmentId === equipmentId,
  );
  if (!snapshot) throw new Error(`Cloud equipment not found: ${equipmentId}`);

  await client.createCommand(aquariumId, {
    commandId: commandId(),
    edgeId: snapshot.edgeId,
    equipmentId,
    type: "equipment.set-program-type",
    payload: { programType },
  });

  const deadline =
    Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(cloudCommandConfirmationPollMilliseconds);
    const reported = (await client.listEquipment(aquariumId)).find(
      (item) => item.equipmentId === equipmentId,
    )?.document;
    if (isEquipment(reported) && reported.programType === programType) {
      return { ...reported, aquariumId };
    }
  }

  throw new Error(
    `${equipmentId} did not confirm its updated AUTO program within 30 seconds`,
  );
}

async function sendEquipmentConfigurationCommand(
  equipmentId: string,
  type: string,
  payload: Record<string, unknown>,
  confirmed: (equipment: Equipment) => boolean,
  description: string,
  applyCompletedCommand?: (equipment: Equipment) => Equipment,
): Promise<Equipment> {
  const client = cloudClient();
  const aquariumId = await selectedAquariumId(client);
  const snapshot = (await client.listEquipment(aquariumId)).find(
    (item) => item.equipmentId === equipmentId,
  );
  if (!snapshot) throw new Error(`Cloud equipment not found: ${equipmentId}`);
  if (!isEquipment(snapshot.document)) {
    throw new Error(`Cloud equipment is invalid: ${equipmentId}`);
  }

  const request = {
    commandId: commandId(),
    edgeId: snapshot.edgeId,
    equipmentId,
    type,
    payload,
  };
  let command = await client.createCommand(aquariumId, request);

  const deadline = Date.now() + cloudCommandConfirmationTimeoutMilliseconds;
  while (Date.now() < deadline) {
    if (command.status === "failed") {
      throw new Error(`The Reef Controller rejected ${description}`);
    }
    if (command.status === "completed" && applyCompletedCommand) {
      return {
        ...applyCompletedCommand(snapshot.document),
        aquariumId,
      };
    }
    await delay(cloudCommandConfirmationPollMilliseconds);
    command = await client.createCommand(aquariumId, request);
    if (applyCompletedCommand) continue;
    const reported = (await client.listEquipment(aquariumId)).find(
      (item) => item.equipmentId === equipmentId,
    )?.document;
    if (isEquipment(reported) && confirmed(reported)) {
      return { ...reported, aquariumId };
    }
  }
  throw new Error(`${equipmentId} did not confirm ${description} within 30 seconds`);
}

export async function setDashboardEquipmentSchedule(
  equipmentId: string,
  schedule: EquipmentSchedule,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeEquipmentSchedule(equipmentId, schedule);
  }
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.set-schedule",
    { schedule },
    (equipment) => jsonDocumentsEquivalent(equipment.schedule, schedule),
    "its schedule",
  );
}

export async function setDashboardEquipmentSpeed(
  equipmentId: string,
  percent: number,
): Promise<Equipment> {
  if (dashboardConnectionMode() !== "cloud") return setEdgeEquipmentSpeed(equipmentId, percent);
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.set-speed",
    { percent },
    (equipment) => equipment.speedPercent === percent,
    `its speed at ${percent}%`,
  );
}

export async function setDashboardEquipmentSpeedSchedule(
  equipmentId: string,
  speedSchedule: EquipmentSpeedSchedule,
): Promise<Equipment> {
  if (dashboardConnectionMode() !== "cloud") return setEdgeEquipmentSpeedSchedule(equipmentId, speedSchedule);
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.set-speed-schedule",
    { speedSchedule },
    (equipment) => jsonDocumentsEquivalent(equipment.speedSchedule, speedSchedule),
    "its pump speed schedule",
  );
}

export async function setDashboardEquipmentIntervalProgram(
  equipmentId: string,
  intervalProgram: EquipmentIntervalProgram,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeEquipmentIntervalProgram(equipmentId, intervalProgram);
  }
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.set-interval-program",
    { intervalProgram },
    (equipment) => jsonDocumentsEquivalent(equipment.intervalProgram, intervalProgram),
    "its AUTO program",
    (equipment) => ({ ...equipment, intervalProgram }),
  );
}

export async function setDashboardAdvancedOutletProgram(
  equipmentId: string,
  advancedOutletProgram: AdvancedOutletProgram,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeAdvancedOutletProgram(equipmentId, advancedOutletProgram);
  }
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.set-advanced-program",
    { advancedOutletProgram },
    (equipment) => jsonDocumentsEquivalent(equipment.advancedOutletProgram, advancedOutletProgram),
    `advanced program revision ${advancedOutletProgram.revision}`,
  );
}

export async function setDashboardDoserCalibration(
  equipmentId: string,
  calibration: DoserCalibration,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return setEdgeDoserCalibration(equipmentId, calibration);
  }
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.set-doser-calibration",
    { calibration },
    (equipment) => jsonDocumentsEquivalent(equipment.doserCalibration, calibration),
    "its calibration",
  );
}

export async function runDashboardDoserCalibration(
  equipmentId: string,
  runtimeSeconds: 60 | 300 | 600,
): Promise<Equipment> {
  if (dashboardConnectionMode() === "local") {
    return runEdgeDoserCalibration(equipmentId, runtimeSeconds);
  }
  return sendEquipmentConfigurationCommand(
    equipmentId,
    "equipment.run-doser-calibration",
    { runtimeSeconds },
    (equipment) => equipment.enabled && equipment.controlMode === "off",
    "the calibration run",
  );
}
