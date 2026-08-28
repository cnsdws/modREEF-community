import * as SecureStore from "expo-secure-store";
import type {
  EdgeHealthResponse,
  EquipmentCommandResponse,
  EquipmentListResponse,
  RegisteredEdgeCredentials,
  RunDoserCalibrationRequest,
  SetEquipmentPowerRequest,
  SetEquipmentSpeedRequest,
} from "@modreef/api-contract";

import type {
  AdvancedOutletProgram,
  Equipment,
  EquipmentControlMode,
  EquipmentDisplaySetting,
  EquipmentIntervalProgram,
  DoserCalibration,
  DosingParameter,
  EquipmentProgramType,
  EquipmentRole,
  EquipmentSchedule,
  EquipmentSpeedSchedule,
  AquariumDigitalTwin,
  AquariumEvent,
  AquariumEventBase,
  AquariumEventSource,
  WaterProbeCalibration,
} from "@modreef/digital-twin";
import {
  currentEdgeTarget,
  currentEdgeUrl,
  restoreEdgeTarget,
  selectEdgeTarget,
  type EdgeTarget,
} from "./edgeTarget";

export type EdgeHealth = EdgeHealthResponse;

function createCommandId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function getEdgeHealth(
  signal?: AbortSignal,
): Promise<EdgeHealth> {
  await restoreEdgeTarget();
  const edgeUrl = currentEdgeUrl();

  const response = await fetch(`${edgeUrl}/health`, {
    method: "GET",
    signal: signal ?? null,
  });

  if (!response.ok) {
    throw new Error(
      `Edge health request failed: ${response.status}`,
    );
  }

  return (await response.json()) as EdgeHealth;
}

export interface EdgeFeedModeAction {
  equipmentId: string;
  turnOff: true;
  restoreOnCompletion: boolean;
  restoreDelaySeconds: number;
}

export interface EdgeFeedMode {
  id: string;
  intent: "feed-mode";
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  cycleId?: "A" | "B" | "C";
  actions: EdgeFeedModeAction[];
  phase: "feeding" | "recovery";
  completionReason?: "completed" | "cancelled";
  recoveryStartedAt?: string;
  recoveryEndsAt?: string;
  restoredEquipmentIds?: string[];
}

export interface EdgeWaterChangeAction {
  equipmentId: string;
  turnOff: true;
  restoreOnCompletion: boolean;
}

export interface EdgeWaterChange {
  id: string;
  intent: "water-change";
  startedAt: string;
  actions: EdgeWaterChangeAction[];
}

export type EdgeRoutineTask =
  | {
      id: string;
      type: "power";
      equipmentId: string;
      enabled: boolean;
    }
  | {
      id: string;
      type: "wait";
      durationSeconds: number;
    }
  | {
      id: string;
      type: "dose";
      equipmentId: string;
      milliliters: number;
    }
  | {
      id: string;
      type: "restore";
    }
  | {
      id: string;
      type: "hold";
    };

export interface EdgeRoutineDefinition {
  id: string;
  name: string;
  tasks: EdgeRoutineTask[];
  createdAt: string;
  updatedAt: string;
}

export interface EdgeRoutineInput {
  name: string;
  tasks: EdgeRoutineTask[];
}

export interface EdgeActiveRoutine {
  id: string;
  routineId: string;
  name: string;
  startedAt: string;
  taskIndex: number;
  snapshots: Record<string, boolean>;
  holding?: boolean;
  resumeAt?: string;
}

export interface LocalAuthorization {
  token: string;
  expiresAt: string;
}

let onboardingToken: string | null = null;
const localAuthorizationKey = "modreef.controller.local-authorization";
const legacyOnboardingAuthorizationKey = "modreef.edge.onboarding-authorization";

function onboardingAuthorizationKey(): string {
  const edgeId = currentEdgeTarget()?.edgeId;
  return edgeId
    ? `${localAuthorizationKey}.${edgeId}`
    : localAuthorizationKey;
}

function legacyAuthorizationKey(): string {
  const edgeId = currentEdgeTarget()?.edgeId;
  return edgeId
    ? `${legacyOnboardingAuthorizationKey}.${edgeId}`
    : legacyOnboardingAuthorizationKey;
}

interface StoredOnboardingAuthorization {
  token: string;
  expiresAt: string;
}

interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): BrowserStorage | null {
  return (globalThis as { localStorage?: BrowserStorage }).localStorage ?? null;
}

async function loadOnboardingAuthorization(): Promise<string | null> {
  if (await SecureStore.isAvailableAsync()) {
    const current = await SecureStore.getItemAsync(onboardingAuthorizationKey());
    if (current) return current;
    const legacy = await SecureStore.getItemAsync(legacyAuthorizationKey());
    if (legacy) {
      await SecureStore.setItemAsync(onboardingAuthorizationKey(), legacy);
      await SecureStore.deleteItemAsync(legacyAuthorizationKey());
    }
    return legacy;
  }
  const storage = browserStorage();
  const current = storage?.getItem(onboardingAuthorizationKey()) ?? null;
  if (current) return current;
  const legacy = storage?.getItem(legacyAuthorizationKey()) ?? null;
  if (legacy) {
    storage?.setItem(onboardingAuthorizationKey(), legacy);
    storage?.removeItem(legacyAuthorizationKey());
  }
  return legacy;
}

async function saveOnboardingAuthorization(value: string): Promise<void> {
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.setItemAsync(onboardingAuthorizationKey(), value);
    return;
  }

  browserStorage()?.setItem(onboardingAuthorizationKey(), value);
}

async function deleteOnboardingAuthorization(): Promise<void> {
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.deleteItemAsync(onboardingAuthorizationKey());
    return;
  }

  browserStorage()?.removeItem(onboardingAuthorizationKey());
}

let authorizationInitialization: Promise<boolean> | null =
  null;

export function initializeLocalAuthorization(): Promise<boolean> {
  if (onboardingToken) {
    return Promise.resolve(true);
  }

  if (authorizationInitialization) {
    return authorizationInitialization;
  }

  const initialization = (async () => {
    try {
      await restoreEdgeTarget();
      const stored = await loadOnboardingAuthorization();

      if (!stored) {
        return false;
      }

      const authorization =
        JSON.parse(stored) as StoredOnboardingAuthorization;

      if (
        typeof authorization.token !== "string" ||
        typeof authorization.expiresAt !== "string" ||
        Date.parse(authorization.expiresAt) <= Date.now()
      ) {
        await deleteOnboardingAuthorization();
        return false;
      }

      onboardingToken = authorization.token;

      try {
        const response = await fetchWithin(
          `${edgeUrl()}/onboarding/authorization`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${onboardingToken}`,
            },
          },
          5_000,
        );

        if (response.status === 401) {
          onboardingToken = null;
          await deleteOnboardingAuthorization();
          return false;
        }
      } catch {
        // Preserve locally valid authorization while Edge is offline.
      }

      return true;
    } catch {
      return false;
    }
  })();

  authorizationInitialization = initialization;
  void initialization.then((authorized) => {
    if (!authorized && authorizationInitialization === initialization) {
      authorizationInitialization = null;
    }
  });

  return initialization;
}

async function clearOnboardingAuthorization(): Promise<void> {
  onboardingToken = null;
  authorizationInitialization = null;

  await deleteOnboardingAuthorization();
}

function edgeUrl(): string {
  return currentEdgeUrl();
}

export async function configureEdgeTarget(target: EdgeTarget): Promise<void> {
  const changed = currentEdgeTarget()?.edgeId !== target.edgeId;
  await selectEdgeTarget(target);
  if (changed) {
    onboardingToken = null;
    authorizationInitialization = null;
  }
}

export async function probeEdgeTarget(target: EdgeTarget): Promise<EdgeHealth> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchWithin(
        `${target.url}/health`,
        { method: "GET" },
        10_000,
      );
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!response) throw lastError;
  if (!response.ok) throw new Error(`Reef Controller health request failed: ${response.status}`);
  const health = (await response.json()) as EdgeHealth;
  if (health.edgeId !== target.edgeId) {
    throw new Error("The local Reef Controller identity does not match its cloud registration.");
  }
  return health;
}

async function fetchWithin(
  input: string,
  init: RequestInit,
  timeoutMilliseconds: number,
): Promise<Response> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Reef Controller request timed out: ${input}`));
    }, timeoutMilliseconds);
  });

  try {
    return await Promise.race([
      fetch(input, init),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function localClaimWasCommitted(
  url: string,
  edgeId: string,
): Promise<boolean> {
  try {
    const response = await fetchWithin(`${url}/health`, { method: "GET" }, 5_000);
    if (!response.ok) return false;
    const health = (await response.json()) as EdgeHealth;
    return health.claimed === true && health.edgeId === edgeId;
  } catch {
    return false;
  }
}

export async function claimLocalEdge(
  url: string,
  credentials: RegisteredEdgeCredentials,
  claimSecret?: string,
): Promise<void> {
  const normalizedUrl = url.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetchWithin(`${normalizedUrl}/onboarding/cloud-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...credentials,
        ...(claimSecret ? { claimSecret } : {}),
      }),
    }, 15_000);
  } catch (error) {
    if (await localClaimWasCommitted(normalizedUrl, credentials.edgeId)) return;
    throw error;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (await localClaimWasCommitted(normalizedUrl, credentials.edgeId)) return;
    throw new Error(body.error ?? `Could not claim Reef Controller: ${response.status}`);
  }
  const body = await response.json() as {
    authorization?: LocalAuthorization;
  };
  if (!body.authorization?.token || !body.authorization.expiresAt) {
    throw new Error("The Reef Controller did not authorize local setup");
  }
  onboardingToken = body.authorization.token;
  await saveOnboardingAuthorization(JSON.stringify(body.authorization));
  authorizationInitialization = Promise.resolve(true);
}

export async function authorizeLocalEdgeFromCloud(
  url: string,
  grant: string,
): Promise<void> {
  const response = await fetchWithin(
    `${url.replace(/\/$/, "")}/onboarding/cloud-authorization`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant }),
    },
    10_000,
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Could not authorize local administration: ${response.status}`);
  }
  const body = await response.json() as { authorization?: LocalAuthorization };
  if (!body.authorization?.token || !body.authorization.expiresAt) {
    throw new Error("The Reef Controller did not authorize local administration");
  }
  onboardingToken = body.authorization.token;
  await saveOnboardingAuthorization(JSON.stringify(body.authorization));
  authorizationInitialization = Promise.resolve(true);
}

export async function unclaimLocalEdge(): Promise<void> {
  const response = await authorizedEdgeRequest(
    "/onboarding/cloud-unclaim",
    { method: "POST" },
    10_000,
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      deviceIds?: string[];
    };
    throw new Error(body.error ?? `Could not unassign Reef Controller: ${response.status}`);
  }
  await clearOnboardingAuthorization();
}

async function authorizedEdgeRequest(
  path: string,
  init: RequestInit,
  timeoutMilliseconds = 5_000,
): Promise<Response> {
  await initializeLocalAuthorization();

  if (!onboardingToken) {
    throw new Error("Select this Reef Controller from your cloud account first");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${onboardingToken}`);

  const request = {
    ...init,
    headers,
  };
  // Expo's native fetch implementation can terminate the request bridge when
  // AbortSignal.timeout fires. Keep caller-provided cancellation (Matter jobs
  // use it), but use the JS deadline wrapper for ordinary local requests.
  const response = init.signal
    ? await fetch(`${edgeUrl()}${path}`, request)
    : await fetchWithin(`${edgeUrl()}${path}`, request, timeoutMilliseconds);

  if (response.status === 401) {
    await clearOnboardingAuthorization();
    throw new Error(
      "Reef Controller authorization expired; select the controller again",
    );
  }

  return response;
}

export async function getEdgeEquipment(): Promise<Equipment[]> {
  const response = await authorizedEdgeRequest("/equipment", {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `Could not load Edge equipment: ${response.status}`,
    );
  }

  const body = (await response.json()) as EquipmentListResponse;

  return body.equipment;
}

export async function setEdgeEquipmentPower(
  equipmentId: string,
  on: boolean,
): Promise<Equipment> {
  const request: SetEquipmentPowerRequest = {
    commandId: createCommandId(),
    on,
  };
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/power`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not change equipment power: ${response.status}`,
    );
  }

  const body = (await response.json()) as EquipmentCommandResponse;

  return body.equipment;
}

export async function setEdgeEquipmentSpeed(
  equipmentId: string,
  percent: number,
): Promise<Equipment> {
  const request: SetEquipmentSpeedRequest = { commandId: createCommandId(), percent };
  const response = await authorizedEdgeRequest(`/equipment/${encodeURIComponent(equipmentId)}/speed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Could not change pump speed: ${response.status}`);
  return ((await response.json()) as EquipmentCommandResponse).equipment;
}

export async function setEdgeEquipmentSpeedSchedule(
  equipmentId: string,
  speedSchedule: EquipmentSpeedSchedule,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(`/equipment/${encodeURIComponent(equipmentId)}/speed-schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(speedSchedule),
  });
  if (!response.ok) throw new Error(`Could not update pump schedule: ${response.status}`);
  return ((await response.json()) as { equipment: Equipment }).equipment;
}

export async function setEdgeWavemakerConfiguration(
  equipmentId: string,
  feedCycleParticipation: boolean,
  linkRole: "independent" | "master" | "slave",
  mode: "M1" | "M2" | "M3" | "M4" | "M5",
  modeSettings?: Equipment["wavemakerModeSettings"],
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/wavemaker`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedCycleParticipation, linkRole, mode, modeSettings }),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Could not update wavemaker: ${response.status}`);
  }
  return ((await response.json()) as { equipment: Equipment }).equipment;
}

export async function setEdgeWaterProbeCalibration(
  equipmentId: string,
  calibration: WaterProbeCalibration,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/water-calibration`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calibration }),
    },
  );
  const body = await response.json() as { equipment?: Equipment; error?: string };
  if (!response.ok || !body.equipment) {
    throw new Error(body.error ?? `Could not save probe calibration: ${response.status}`);
  }
  return body.equipment;
}

export async function setEdgeEquipmentControlMode(
  equipmentId: string,
  mode: EquipmentControlMode,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/control-mode`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not change equipment control mode: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    equipment: Equipment;
  };

  return body.equipment;
}

export async function cloneEdgeEquipmentConfiguration(
  sourceEquipmentId: string,
  destinationEquipmentId: string,
  name: string,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(sourceEquipmentId)}/clone`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destinationEquipmentId, name }),
    },
  );
  const body = (await response.json()) as { equipment?: Equipment; error?: string };
  if (!response.ok || !body.equipment) {
    throw new Error(body.error ?? `Could not clone configuration: ${response.status}`);
  }
  return body.equipment;
}

export async function swapEdgeEquipmentBindings(
  equipmentId: string,
  otherEquipmentId: string,
): Promise<Equipment[]> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/swap-binding`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otherEquipmentId }),
    },
  );
  const body = (await response.json()) as { equipment?: Equipment[]; error?: string };
  if (!response.ok || !body.equipment) {
    throw new Error(body.error ?? `Could not swap outlets: ${response.status}`);
  }
  return body.equipment;
}

export async function setEdgeEquipmentProgramType(
  equipmentId: string,
  programType: EquipmentProgramType,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/program-type`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ programType }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not change equipment program type: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    equipment: Equipment;
  };

  return body.equipment;
}

export async function setEdgeEquipmentIntervalProgram(
  equipmentId: string,
  intervalProgram: EquipmentIntervalProgram,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/interval-program`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(intervalProgram),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not update interval program: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    equipment: Equipment;
  };

  return body.equipment;
}

export async function setEdgeAdvancedOutletProgram(
  equipmentId: string,
  advancedOutletProgram: AdvancedOutletProgram,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/advanced-program`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(advancedOutletProgram),
    },
  );
  if (!response.ok) throw new Error(`Could not update advanced outlet program: ${response.status}`);
  return ((await response.json()) as { equipment: Equipment }).equipment;
}

export async function runEdgeDoserCalibration(
  equipmentId: string,
  runtimeSeconds: 60 | 300 | 600,
): Promise<Equipment> {
  const request: RunDoserCalibrationRequest = {
    commandId: createCommandId(),
    runtimeSeconds,
  };
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/doser-calibration-run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    throw new Error(`Could not start calibration run: ${response.status}`);
  }

  const body = (await response.json()) as EquipmentCommandResponse;
  return body.equipment;
}

export async function setEdgeDoserCalibration(
  equipmentId: string,
  calibration: DoserCalibration,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/doser-calibration`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calibration),
    },
  );

  if (!response.ok) {
    throw new Error(`Could not save doser calibration: ${response.status}`);
  }

  const body = (await response.json()) as { equipment: Equipment };
  return body.equipment;
}

export async function setEdgeEquipmentSchedule(
  equipmentId: string,
  schedule: EquipmentSchedule,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/schedule`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(schedule),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not update equipment schedule: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    equipment: Equipment;
  };

  return body.equipment;
}

export async function updateEdgeEquipment(
  equipmentId: string,
  name: string,
  role: EquipmentRole,
  automaticRestartDelaySeconds?: number,
  dosingParameter?: DosingParameter,
  dosingParameterName?: string,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        role,
        ...(automaticRestartDelaySeconds === undefined
          ? {}
          : { automaticRestartDelaySeconds }),
        ...(dosingParameter === undefined ? {} : { dosingParameter }),
        ...(dosingParameterName === undefined ? {} : { dosingParameterName }),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not update equipment: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    equipment: Equipment;
  };

  return body.equipment;
}

export async function updateEdgeEquipmentDisplay(
  equipmentId: string,
  displayOrder: number,
  hiddenFromDashboard: boolean,
): Promise<Equipment> {
  const response = await authorizedEdgeRequest(
    `/equipment/${encodeURIComponent(equipmentId)}/display`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayOrder, hiddenFromDashboard }),
    },
  );
  if (!response.ok) throw new Error(`Could not save equipment layout: ${response.status}`);
  return ((await response.json()) as { equipment: Equipment }).equipment;
}

export async function updateEdgeEquipmentLayout(
  settings: EquipmentDisplaySetting[],
): Promise<Equipment[]> {
  const response = await authorizedEdgeRequest("/equipment-layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  const body = (await response.json()) as { equipment?: Equipment[]; error?: string };
  if (!response.ok || !body.equipment) {
    throw new Error(body.error ?? `Could not update equipment layout: ${response.status}`);
  }
  return body.equipment;
}

export async function getEdgeFeedMode(): Promise<EdgeFeedMode | null> {
  const response = await authorizedEdgeRequest("/modes/feed", {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `Could not load Feed Mode: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    active: EdgeFeedMode | null;
  };

  return body.active;
}

export async function startEdgeFeedMode(
  durationSeconds: number,
  skimmerRestartDelaySeconds: number,
  cycleId?: "A" | "B" | "C",
): Promise<EdgeFeedMode> {
  const response = await authorizedEdgeRequest("/modes/feed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      durationSeconds,
      skimmerRestartDelaySeconds,
      ...(cycleId ? { cycleId } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not start Feed Mode: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    active: EdgeFeedMode;
  };

  return body.active;
}

export async function stopEdgeFeedMode(): Promise<EdgeFeedMode | null> {
  const response = await authorizedEdgeRequest("/modes/feed", {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(
      `Could not stop Feed Mode: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    active: EdgeFeedMode | null;
  };

  return body.active;
}

export async function getEdgeWaterChange(): Promise<{
  active: EdgeWaterChange | null;
  routine: EdgeRoutineDefinition | null;
}> {
  const response = await authorizedEdgeRequest("/routines/water-change", {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Could not load Water Change: ${response.status}`);
  }

  const body = (await response.json()) as {
    active: EdgeWaterChange | null;
    routine: EdgeRoutineDefinition | null;
  };

  return body;
}

export async function updateEdgeWaterChangeRoutine(
  input: EdgeRoutineInput,
): Promise<EdgeRoutineDefinition> {
  const response = await authorizedEdgeRequest("/routines/water-change", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await routineRequestError(response, "Could not update Water Change");
  }

  const body = (await response.json()) as {
    routine: EdgeRoutineDefinition;
  };
  return body.routine;
}

export async function startEdgeWaterChange(): Promise<EdgeWaterChange> {
  const response = await authorizedEdgeRequest("/routines/water-change", {
    method: "POST",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      body?.error ?? `Could not start Water Change: ${response.status}`,
    );
  }

  const body = (await response.json()) as { active: EdgeWaterChange };
  return body.active;
}

export async function stopEdgeWaterChange(): Promise<void> {
  const response = await authorizedEdgeRequest("/routines/water-change", {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Could not stop Water Change: ${response.status}`);
  }
}

async function routineRequestError(
  response: Response,
  fallback: string,
): Promise<Error> {
  const body = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return new Error(body?.error ?? `${fallback}: ${response.status}`);
}

export async function getEdgeRoutines(): Promise<{
  routines: EdgeRoutineDefinition[];
  active: EdgeActiveRoutine | null;
}> {
  const response = await authorizedEdgeRequest("/routines/custom", {
    method: "GET",
  });

  if (!response.ok) {
    throw await routineRequestError(response, "Could not load routines");
  }

  return (await response.json()) as {
    routines: EdgeRoutineDefinition[];
    active: EdgeActiveRoutine | null;
  };
}

export async function createEdgeRoutine(
  input: EdgeRoutineInput,
): Promise<EdgeRoutineDefinition> {
  const response = await authorizedEdgeRequest("/routines/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await routineRequestError(response, "Could not create routine");
  }

  return ((await response.json()) as { routine: EdgeRoutineDefinition }).routine;
}

export async function updateEdgeRoutine(
  routineId: string,
  input: EdgeRoutineInput,
): Promise<EdgeRoutineDefinition> {
  const response = await authorizedEdgeRequest(
    `/routines/custom/${encodeURIComponent(routineId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw await routineRequestError(response, "Could not update routine");
  }

  return ((await response.json()) as { routine: EdgeRoutineDefinition }).routine;
}

export async function deleteEdgeRoutine(routineId: string): Promise<void> {
  const response = await authorizedEdgeRequest(
    `/routines/custom/${encodeURIComponent(routineId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw await routineRequestError(response, "Could not delete routine");
  }
}

export async function runEdgeRoutine(
  routineId: string,
): Promise<EdgeActiveRoutine | null> {
  const response = await authorizedEdgeRequest(
    `/routines/custom/${encodeURIComponent(routineId)}/run`,
    { method: "POST" },
  );

  if (!response.ok) {
    throw await routineRequestError(response, "Could not run routine");
  }

  return ((await response.json()) as { active: EdgeActiveRoutine | null }).active;
}

export async function stopEdgeRoutine(): Promise<void> {
  const response = await authorizedEdgeRequest("/routines/custom/active", {
    method: "DELETE",
  });

  if (!response.ok) {
    throw await routineRequestError(response, "Could not stop routine");
  }
}

export async function finishEdgeRoutine(): Promise<void> {
  const response = await authorizedEdgeRequest(
    "/routines/custom/active/finish",
    { method: "POST" },
  );

  if (!response.ok) {
    throw await routineRequestError(response, "Could not finish routine");
  }
}

export interface GHomeWp12Credentials {
  deviceId: string;
  localKey: string;
  networkAddress?: string;
  displayName?: string;
  productId?: string;
  initialDps?: Record<string, unknown>;
}

export interface MdpPumpCandidate {
  deviceId: string;
  networkAddress: string;
  macAddress: string;
  moduleId: string;
  productKey?: string;
  firmwareVersion?: string;
}

export interface Md44DoserCandidate {
  deviceId: string;
  gizwitsDeviceId: string;
  networkAddress: string;
  macAddress: string;
  moduleId: string;
  productKey?: string;
  firmwareVersion?: string;
  headCount: 4;
  localControlReady: boolean;
  statusFrameLength?: number;
  statusError?: string;
}

export async function discoverMd44Dosers(): Promise<Md44DoserCandidate[]> {
  const response = await authorizedEdgeRequest("/onboarding/md44", {
    method: "GET",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json() as {
    devices?: Md44DoserCandidate[];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not scan for Wi-Fi dosers");
  return body.devices ?? [];
}

export async function registerMd44Doser(
  candidate: Md44DoserCandidate,
  displayName = "Jebao MD-4.4",
): Promise<string> {
  const response = await authorizedEdgeRequest("/onboarding/md44", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      deviceId: candidate.deviceId,
      networkAddress: candidate.networkAddress,
      gizwitsDeviceId: candidate.gizwitsDeviceId,
      displayName,
    }),
  });
  const body = await response.json() as { device?: { id?: string }; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not add MD-4.4 doser");
  if (!body.device?.id) throw new Error("The Reef Controller did not return the doser");
  return body.device.id;
}

export async function discoverMdpPumps(): Promise<MdpPumpCandidate[]> {
  const response = await authorizedEdgeRequest("/onboarding/mdp", {
    method: "GET",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json() as {
    devices?: MdpPumpCandidate[];
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not scan for Wi-Fi pumps");
  return body.devices ?? [];
}

export interface ProvisionedGizwitsEquipment {
  deviceId: string;
  gizwitsDeviceId: string;
  networkAddress: string;
  macAddress: string;
  moduleId: string;
  productKey?: string;
  firmwareVersion?: string;
  equipmentType: "jebao-md44" | "jebao-mdp" | "unknown-gizwits";
  localControlReady: boolean;
  headCount?: number;
  statusFrameLength?: number;
}

export async function provisionGizwitsEquipment(
  input: { ssid: string; password: string },
  onProgress?: (message: string) => void,
): Promise<ProvisionedGizwitsEquipment> {
  const response = await authorizedEdgeRequest("/onboarding/gizwits/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(input),
  });
  const body = await response.json() as {
    job?: { id?: string; message?: string };
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not start Wi-Fi equipment setup");
  if (!body.job?.id) throw new Error("The Reef Controller did not return an equipment setup job");
  onProgress?.(body.job.message ?? "Wi-Fi equipment setup queued…");
  let consecutiveStatusFailures = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    let statusResponse: Response;
    try {
      statusResponse = await authorizedEdgeRequest(
        `/onboarding/gizwits/provision/${encodeURIComponent(body.job.id)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      consecutiveStatusFailures = 0;
    } catch (error) {
      consecutiveStatusFailures += 1;
      if (consecutiveStatusFailures >= 5) throw error;
      continue;
    }
    const statusBody = await statusResponse.json() as {
      job?: {
        status?: "queued" | "running" | "completed" | "failed";
        message?: string;
        device?: ProvisionedGizwitsEquipment;
        error?: string;
      };
      error?: string;
    };
    if (!statusResponse.ok || !statusBody.job) {
      throw new Error(statusBody.error ?? "Could not read equipment setup status");
    }
    onProgress?.(statusBody.job.message ?? "Wi-Fi equipment setup in progress…");
    if (statusBody.job.status === "completed") {
      if (!statusBody.job.device) throw new Error("Equipment setup completed without a device");
      return statusBody.job.device;
    }
    if (statusBody.job.status === "failed") {
      throw new Error(statusBody.job.error ?? statusBody.job.message ?? "Wi-Fi equipment setup failed");
    }
  }
}

export async function registerMdpPump(
  candidate: MdpPumpCandidate,
  displayName: string,
  model: "MDP-8500" | "MDP-20000" = "MDP-8500",
): Promise<string> {
  const response = await authorizedEdgeRequest("/onboarding/mdp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      deviceId: candidate.deviceId,
      networkAddress: candidate.networkAddress,
      displayName,
      model,
    }),
  });
  const body = await response.json() as {
    device?: { id?: string };
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not add MDP pump");
  if (!body.device?.id) throw new Error("The Reef Controller did not return the pump");
  return body.device.id;
}

export interface DmpBleCandidate {
  advertisedName: string;
  bluetoothAddress: string;
  signalStrength?: number;
}

export async function discoverDmpWavemakers(): Promise<DmpBleCandidate[]> {
  const response = await authorizedEdgeRequest("/onboarding/dmp/discover", {
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json() as { devices?: DmpBleCandidate[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not scan for Jebao wavemakers");
  return body.devices ?? [];
}

export async function registerDmpWavemaker(
  candidate: DmpBleCandidate,
  displayName = "Jebao Wavemaker",
): Promise<string> {
  const suffix = candidate.bluetoothAddress.replace(/:/g, "").slice(-6);
  if (!suffix) throw new Error("The DMP wavemaker identity could not be read");
  const response = await authorizedEdgeRequest("/onboarding/dmp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      deviceId: `dmp-${suffix.toLowerCase()}`,
      advertisedName: candidate.advertisedName,
      bluetoothAddress: candidate.bluetoothAddress,
      displayName,
    }),
  });
  const body = await response.json() as { device?: { id?: string }; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not add DMP wavemaker");
  if (!body.device?.id) throw new Error("The Reef Controller did not return the wavemaker");
  return body.device.id;
}

export async function provisionMdpPump(
  input: {
    ssid: string;
    password: string;
    displayName: string;
    model?: "MDP-8500" | "MDP-20000";
  },
  onProgress?: (message: string) => void,
): Promise<string> {
  const response = await authorizedEdgeRequest("/onboarding/mdp/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(input),
  });
  const body = await response.json() as {
    job?: { id?: string; message?: string };
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? "Could not start MDP pump setup");
  if (!body.job?.id) throw new Error("The Reef Controller did not return a pump setup job");
  onProgress?.(body.job.message ?? "Pump setup queued…");
  let consecutiveStatusFailures = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    let statusResponse: Response;
    try {
      statusResponse = await authorizedEdgeRequest(
        `/onboarding/mdp/provision/${encodeURIComponent(body.job.id)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      consecutiveStatusFailures = 0;
    } catch (error) {
      consecutiveStatusFailures += 1;
      if (consecutiveStatusFailures >= 5) throw error;
      onProgress?.("Pump setup continues on the Reef Controller. Reconnecting to status…");
      continue;
    }
    const statusBody = await statusResponse.json() as {
      job?: {
        status?: "queued" | "running" | "completed" | "failed";
        message?: string;
        device?: { id?: string };
      };
      error?: string;
    };
    if (!statusResponse.ok || !statusBody.job) {
      throw new Error(statusBody.error ?? "Could not read pump setup status");
    }
    onProgress?.(statusBody.job.message ?? "Pump setup in progress…");
    if (statusBody.job.status === "completed") {
      if (!statusBody.job.device?.id) throw new Error("Pump setup completed without a device");
      return statusBody.job.device.id;
    }
    if (statusBody.job.status === "failed") {
      throw new Error(statusBody.job.message ?? "MDP pump setup failed");
    }
  }
}

export async function commissionMatterDevice(
  pairingCode: string,
  displayName?: string,
  wifiNetwork?: { ssid: string; password: string },
  compatibilityHint?: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const response = await authorizedEdgeRequest("/onboarding/matter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      pairingCode,
      displayName,
      ...(wifiNetwork ? { ssid: wifiNetwork.ssid, password: wifiNetwork.password } : {}),
      ...(compatibilityHint ? { compatibilityHint } : {}),
    }),
  });
  const body = (await response.json()) as {
    job?: {
      id?: string;
      status?: "queued" | "running" | "completed" | "failed";
      message?: string;
      device?: { id?: string };
    };
    device?: { id?: string };
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? `Could not commission Matter device: ${response.status}`);
  }
  // Compatibility with an Edge that still returns the completed device in
  // the initial response.
  if (body.device?.id) return body.device.id;
  if (!body.job?.id) throw new Error("The Reef Controller did not return a pairing job");

  onProgress?.(body.job.message ?? "Pairing queued…");
  let consecutiveStatusFailures = 0;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    let statusResponse: Response;
    try {
      statusResponse = await authorizedEdgeRequest(
        `/onboarding/matter/${encodeURIComponent(body.job.id)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      consecutiveStatusFailures = 0;
    } catch (error) {
      consecutiveStatusFailures += 1;
      if (consecutiveStatusFailures >= 5) throw error;
      onProgress?.("Pairing continues on the Reef Controller. Reconnecting to status…");
      continue;
    }
    const statusBody = (await statusResponse.json()) as {
      job?: {
        status?: "queued" | "running" | "completed" | "failed";
        message?: string;
        device?: { id?: string };
      };
      error?: string;
    };
    if (!statusResponse.ok || !statusBody.job) {
      throw new Error(
        statusResponse.status === 404
          ? "The Reef Controller restarted during pairing. Factory-reset the device and try again."
          : statusBody.error ?? "Could not read device pairing status",
      );
    }
    onProgress?.(statusBody.job.message ?? "Pairing in progress…");
    if (statusBody.job.status === "completed") {
      if (!statusBody.job.device?.id) {
        throw new Error("The Reef Controller completed pairing without returning the device");
      }
      return statusBody.job.device.id;
    }
    if (statusBody.job.status === "failed") {
      throw new Error(statusBody.job.message ?? "Device pairing failed");
    }
  }
}

export interface EquipmentRegistration {
  deviceId: string;
  displayName: string;
  transport: "bluetooth-le";
  manufacturer?: string;
  model?: string;
  commissioningId?: string;
}

export async function getOnboardedEquipment(): Promise<EquipmentRegistration[]> {
  const response = await authorizedEdgeRequest("/onboarding/equipment", {
    method: "GET",
  });
  if (!response.ok) throw new Error(`Could not load onboarded equipment: ${response.status}`);
  const body = await response.json() as { equipment?: EquipmentRegistration[] };
  return body.equipment ?? [];
}

export async function registerOnboardedEquipment(
  registration: EquipmentRegistration,
): Promise<void> {
  const response = await authorizedEdgeRequest(
    "/onboarding/equipment",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(registration),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not register equipment: ${response.status}`,
    );
  }
}

export async function storeGHomeWp12Credentials(
  credentials: GHomeWp12Credentials,
): Promise<void> {
  await initializeLocalAuthorization();

  if (!onboardingToken) {
    throw new Error(
      "Select this Reef Controller from your cloud account before adding equipment",
    );
  }

  const response = await fetch(
    `${edgeUrl()}/onboarding/credentials/ghome-wp12`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${onboardingToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
    },
  );

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Reef Controller authorization expired; select the controller again"
        : `Could not store device credentials: ${response.status}`,
    );
  }
}

export async function storeYinmikWaterCredentials(
  credentials: GHomeWp12Credentials,
): Promise<void> {
  await initializeLocalAuthorization();
  if (!onboardingToken) {
    throw new Error(
      "Select this Reef Controller from your cloud account before adding equipment",
    );
  }
  const response = await fetch(
    `${edgeUrl()}/onboarding/credentials/yinmik-water`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${onboardingToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    const safeDetails = response.status === 400
      ? ` (device ID ${credentials.deviceId.length} chars, local key ${credentials.localKey.length} chars, address ${credentials.networkAddress ?? "missing"}, name ${credentials.displayName?.length ?? 0} chars, product ${credentials.productId ?? "missing"}, DPS ${Array.isArray(credentials.initialDps) ? "array" : typeof credentials.initialDps})`
      : "";
    throw new Error(
      response.status === 401
        ? "Reef Controller authorization expired; select the controller again"
        : `${body?.error ?? `Could not store water-meter credentials: ${response.status}`}${safeDetails}`,
    );
  }
}

export function getOnboardingToken(): string | null {
  return onboardingToken;
}


export async function getEdgeAquarium(): Promise<
  AquariumDigitalTwin["aquarium"]
> {
  const response = await authorizedEdgeRequest("/aquarium", {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(
      `Could not load aquarium: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    aquarium: AquariumDigitalTwin["aquarium"];
  };

  return body.aquarium;
}

export async function updateEdgeAquariumName(
  name: string,
): Promise<AquariumDigitalTwin["aquarium"]> {
  const response = await authorizedEdgeRequest("/aquarium", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(
      `Could not update aquarium: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    aquarium: AquariumDigitalTwin["aquarium"];
  };

  return body.aquarium;
}

type AquariumEventDetails =
  AquariumEvent extends infer Event
    ? Event extends AquariumEvent
      ? Omit<Event, keyof AquariumEventBase>
      : never
    : never;

export type CreateAquariumEventInput =
  AquariumEventDetails & {
    occurredAt?: string;
    source?: AquariumEventSource;
    notes?: string;
  };

export async function getAquariumEvents(
  limit = 100,
): Promise<AquariumEvent[]> {
  const response = await authorizedEdgeRequest(
    `/aquarium/events?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Could not load aquarium events: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    events: AquariumEvent[];
  };

  return body.events;
}

export async function updateAquariumEvent(
  eventId: string,
  input: CreateAquariumEventInput,
): Promise<AquariumEvent> {
  const response = await authorizedEdgeRequest(
    `/aquarium/events/${encodeURIComponent(eventId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(
      body?.error ??
        `Could not update aquarium event: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    event: AquariumEvent;
  };

  return body.event;
}

export async function deleteAquariumEvent(
  eventId: string,
): Promise<void> {
  const response = await authorizedEdgeRequest(
    `/aquarium/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(
      body?.error ??
        `Could not delete aquarium event: ${response.status}`,
    );
  }
}

export async function createAquariumEvent(
  input: CreateAquariumEventInput,
): Promise<AquariumEvent> {
  const response = await authorizedEdgeRequest(
    "/aquarium/events",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(
      body?.error ??
        `Could not record aquarium event: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    event: AquariumEvent;
  };

  return body.event;
}

export interface EdgeManagedDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
}

export interface DeletedManagedDevice {
  deletedDevice: {
    id: string;
    name: string;
  };
  deletedEquipment: Array<{
    id: string;
    name: string;
  }>;
}

export async function getEdgeManagedDevices(): Promise<EdgeManagedDevice[]> {
  let response: Response | null = null;
  let lastError: unknown;

  // Opening Settings and completing device pairing can briefly overlap an
  // Edge reconnect. Retry this idempotent read so a transient native fetch
  // cancellation does not leave the panel permanently failed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await authorizedEdgeRequest("/managed-devices", {
        method: "GET",
      });
      break;
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 350 * (attempt + 1)),
        );
      }
    }
  }

  if (!response) {
    throw lastError;
  }

  if (!response.ok) {
    throw new Error(
      `Could not load managed devices: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    devices: EdgeManagedDevice[];
  };

  return body.devices;
}

export async function renameEdgeManagedDevice(
  deviceId: string,
  name: string,
): Promise<EdgeManagedDevice> {
  const response = await authorizedEdgeRequest(
    `/managed-devices/${encodeURIComponent(deviceId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(
      body?.error ??
        `Could not rename managed device: ${response.status}`,
    );
  }

  const body = (await response.json()) as {
    device: EdgeManagedDevice;
  };

  return body.device;
}

export async function deleteEdgeManagedDevice(
  deviceId: string,
): Promise<DeletedManagedDevice> {
  const response = await authorizedEdgeRequest(
    `/managed-devices/${encodeURIComponent(deviceId)}`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    throw new Error(
      body?.error ??
        `Could not delete managed device: ${response.status}`,
    );
  }

  return (await response.json()) as DeletedManagedDevice;
}
