import type { Equipment, PhysicalDevice } from "@modreef/digital-twin";
import type { WaterAlarmSettings } from "./water-alarm-settings";

export * from "./reef-coach";
export * from "./water-alarm-settings";

export type CommandId = string;

export const aquariumRoles = ["view", "control", "program", "manage", "owner"] as const;
export type AquariumRole = typeof aquariumRoles[number];

export const aquariumRoleCapabilities: Record<AquariumRole, {
  control: boolean;
  program: boolean;
  manageUsers: boolean;
  own: boolean;
}> = {
  view: { control: false, program: false, manageUsers: false, own: false },
  control: { control: true, program: false, manageUsers: false, own: false },
  program: { control: true, program: true, manageUsers: false, own: false },
  manage: { control: true, program: true, manageUsers: true, own: false },
  owner: { control: true, program: true, manageUsers: true, own: true },
};

export interface AquariumMember {
  userId: string;
  email: string | null;
  role: AquariumRole;
  receiveAlarms: boolean;
  joinedAt: string;
  currentUser?: boolean;
  pending?: boolean;
  invitedAt?: string | null;
  acceptedAt?: string | null;
  expiresAt?: string | null;
}

export type AuthorizationAuditAction =
  | "member.invited"
  | "member.invitation-resent"
  | "member.accepted"
  | "member.role-changed"
  | "member.removed"
  | "member.notification-changed"
  | "ownership.transferred";

export interface AuthorizationAuditEvent {
  id: string;
  aquariumId: string;
  actorEmail: string | null;
  targetEmail: string | null;
  action: AuthorizationAuditAction;
  details: Record<string, unknown>;
  occurredAt: string;
}

export interface AquariumExport {
  schemaVersion: "1";
  exportedAt: string;
  aquarium: AquariumSummary;
  controllers: EdgeSummary[];
  devices: CloudDeviceSnapshot[];
  equipment: CloudEquipmentSnapshot[];
  events: AquariumEvent[];
  waterAlarmSettings: WaterAlarmSettings | null;
  members: AquariumMember[];
  authorizationAudit: AuthorizationAuditEvent[];
}

export interface AddAquariumMemberRequest {
  email: string;
  role: Exclude<AquariumRole, "owner">;
  receiveAlarms?: boolean;
}

export interface UpdateAquariumMemberRequest {
  role?: Exclude<AquariumRole, "owner">;
  receiveAlarms?: boolean;
}

export function isAquariumRole(value: unknown): value is AquariumRole {
  return typeof value === "string" && aquariumRoles.includes(value as AquariumRole);
}

export interface AquariumSummary {
  id: string;
  name: string;
  role: AquariumRole;
  createdAt: string;
  archivedAt?: string | null;
}

export interface AquariumArchiveConflict {
  controllerIds: string[];
}

export interface CreateAquariumRequest {
  name: string;
}

export interface RegisterEdgeRequest {
  name: string;
}

export interface RegisteredEdgeCredentials {
  edgeId: string;
  aquariumId: string;
  token: string;
}

export interface FeedCycleRuntimeState {
  id: string;
  status: "feeding" | "recovery";
  startedAt: string;
  endsAt: string;
  durationSeconds: number;
  cycleId?: "A" | "B" | "C";
  recoveryEndsAt?: string;
}

export type RoutineTask =
  | { id: string; type: "power"; equipmentId: string; enabled: boolean }
  | { id: string; type: "wait"; durationSeconds: number }
  | { id: string; type: "dose"; equipmentId: string; milliliters: number }
  | { id: string; type: "restore" }
  | { id: string; type: "hold" };

export interface RoutineDefinition {
  id: string;
  name: string;
  tasks: RoutineTask[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineDefinitionInput {
  name: string;
  tasks: RoutineTask[];
}

export interface ActiveRoutineExecution {
  id: string;
  routineId: string;
  name: string;
  startedAt: string;
  taskIndex: number;
  snapshots: Record<string, boolean>;
  holding?: boolean;
  resumeAt?: string;
}

export interface RoutineRuntimeState {
  definitions: RoutineDefinition[];
  active: ActiveRoutineExecution | null;
}

export interface EdgeRuntimeState {
  feedCycle: FeedCycleRuntimeState | null;
  controllerUpdate?: ControllerUpdateRuntimeState;
  routines?: RoutineRuntimeState;
}

export interface ControllerUpdateRuntimeState {
  status: "idle" | "requested" | "checking" | "installing" | "up-to-date" | "succeeded" | "failed";
  installedRelease?: string;
  targetRelease?: string;
  lastCheckedAt?: string;
  lastSucceededAt?: string;
  message?: string;
  automaticUpdatesEnabled: boolean;
  releaseChannel?: "production" | "staging";
}

export interface EdgeSummary {
  id: string;
  aquariumId: string;
  name: string;
  status: "online" | "offline" | "provisioning";
  softwareVersion: string | null;
  lastSeenAt: string | null;
  localHostname: string | null;
  localAddress?: string | null;
  runtimeState: EdgeRuntimeState;
}

export interface CloudEquipmentSnapshot {
  equipmentId: string;
  edgeId: string;
  document: unknown;
  reportedAt: string;
}

export interface CloudDeviceSnapshot {
  deviceId: string;
  edgeId: string;
  document: PhysicalDevice;
  reportedAt: string;
}

export interface AquariumEvent {
  eventId: string;
  aquariumId: string;
  edgeId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  document: unknown;
}

export interface CloudCommandRequest extends CommandRequest {
  edgeId: string;
  equipmentId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface CloudCommand extends CloudCommandRequest {
  aquariumId: string;
  status: "queued" | "delivered" | "completed" | "failed";
  createdAt: string;
  message?: string;
}

export interface EdgeSyncEvent {
  eventId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  document: unknown;
}

export interface EdgeCommandResult {
  commandId: CommandId;
  status: "completed" | "failed";
  message?: string;
}

export interface EdgeSyncRequest {
  edgeId: string;
  aquariumId: string;
  softwareVersion: string;
  uptimeSeconds: number;
  localHostname?: string;
  localAddress?: string;
  /** Optional during rolling upgrades; current Edge versions always report it. */
  devices?: CloudDeviceSnapshot[];
  equipment: CloudEquipmentSnapshot[];
  events: EdgeSyncEvent[];
  commandResults: EdgeCommandResult[];
  runtimeState?: EdgeRuntimeState;
}

export interface EdgeSyncResponse {
  acceptedThroughSequence: number;
  acceptedCommandIds: CommandId[];
  commands: CloudCommand[];
  serverTime: string;
  waterAlarmSettings?: WaterAlarmSettings;
}

export function isEdgeSyncRequest(value: unknown): value is EdgeSyncRequest {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.edgeId === "string" && item.edgeId.length > 0 &&
    typeof item.aquariumId === "string" && item.aquariumId.length > 0 &&
    typeof item.softwareVersion === "string" &&
    typeof item.uptimeSeconds === "number" && item.uptimeSeconds >= 0 &&
    (item.localHostname === undefined ||
      (typeof item.localHostname === "string" && item.localHostname.length > 0)) &&
    (item.localAddress === undefined ||
      (typeof item.localAddress === "string" && item.localAddress.length > 0)) &&
    (item.runtimeState === undefined || isEdgeRuntimeState(item.runtimeState)) &&
    (item.devices === undefined ||
      (Array.isArray(item.devices) && item.devices.length <= 1000 && item.devices.every((snapshot) => {
        if (typeof snapshot !== "object" || snapshot === null) return false;
        const candidate = snapshot as Record<string, unknown>;
        return typeof candidate.deviceId === "string" && candidate.deviceId.length > 0 &&
          typeof candidate.edgeId === "string" && candidate.edgeId === item.edgeId &&
          typeof candidate.reportedAt === "string" &&
          typeof candidate.document === "object" && candidate.document !== null;
      }))) &&
    Array.isArray(item.equipment) && item.equipment.length <= 1000 && item.equipment.every((snapshot) => {
      if (typeof snapshot !== "object" || snapshot === null) return false;
      const candidate = snapshot as Record<string, unknown>;
      return typeof candidate.equipmentId === "string" && candidate.equipmentId.length > 0 &&
        typeof candidate.edgeId === "string" && candidate.edgeId === item.edgeId &&
        typeof candidate.reportedAt === "string";
    }) &&
    Array.isArray(item.events) && item.events.length <= 1000 && item.events.every((event) => {
      if (typeof event !== "object" || event === null) return false;
      const candidate = event as Record<string, unknown>;
      return typeof candidate.eventId === "string" &&
        Number.isSafeInteger(candidate.sequence) && Number(candidate.sequence) > 0 &&
        typeof candidate.type === "string" && typeof candidate.occurredAt === "string";
    }) &&
    Array.isArray(item.commandResults) && item.commandResults.length <= 1000 && item.commandResults.every((result) => {
      if (typeof result !== "object" || result === null) return false;
      const candidate = result as Record<string, unknown>;
      return isCommandId(candidate.commandId) &&
        (candidate.status === "completed" || candidate.status === "failed") &&
        (candidate.message === undefined || typeof candidate.message === "string");
    })
  );
}

export function isEdgeRuntimeState(value: unknown): value is EdgeRuntimeState {
  if (typeof value !== "object" || value === null || !("feedCycle" in value)) return false;
  const runtime = value as Record<string, unknown>;
  const update = runtime.controllerUpdate;
  if (update !== undefined) {
    if (typeof update !== "object" || update === null) return false;
    const item = update as Record<string, unknown>;
    if (![
      "idle", "requested", "checking", "installing", "up-to-date", "succeeded", "failed",
    ].includes(String(item.status)) || typeof item.automaticUpdatesEnabled !== "boolean" ||
      (item.releaseChannel !== undefined &&
        item.releaseChannel !== "production" && item.releaseChannel !== "staging")) return false;
    for (const key of ["installedRelease", "targetRelease", "lastCheckedAt", "lastSucceededAt", "message"]) {
      if (item[key] !== undefined && typeof item[key] !== "string") return false;
    }
  }
  if (runtime.routines !== undefined && !isRoutineRuntimeState(runtime.routines)) {
    return false;
  }
  const feedCycle = runtime.feedCycle;
  if (feedCycle === null) return true;
  if (typeof feedCycle !== "object" || feedCycle === null) return false;
  const item = feedCycle as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 &&
    (item.status === "feeding" || item.status === "recovery") &&
    typeof item.startedAt === "string" && typeof item.endsAt === "string" &&
    Number.isSafeInteger(item.durationSeconds) && Number(item.durationSeconds) > 0 &&
    (item.recoveryEndsAt === undefined || typeof item.recoveryEndsAt === "string");
}

function isRoutineTask(value: unknown): value is RoutineTask {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || task.id.length < 1) return false;
  if (task.type === "power") {
    return typeof task.equipmentId === "string" && typeof task.enabled === "boolean";
  }
  if (task.type === "wait") {
    return Number.isSafeInteger(task.durationSeconds) && Number(task.durationSeconds) > 0;
  }
  if (task.type === "dose") {
    return typeof task.equipmentId === "string" &&
      typeof task.milliliters === "number" && Number.isFinite(task.milliliters);
  }
  return task.type === "restore" || task.type === "hold";
}

function isRoutineDefinition(value: unknown): value is RoutineDefinition {
  if (typeof value !== "object" || value === null) return false;
  const routine = value as Record<string, unknown>;
  return typeof routine.id === "string" && routine.id.length > 0 &&
    typeof routine.name === "string" && routine.name.length > 0 &&
    typeof routine.createdAt === "string" && typeof routine.updatedAt === "string" &&
    Array.isArray(routine.tasks) && routine.tasks.length <= 50 &&
    routine.tasks.every(isRoutineTask);
}

function isActiveRoutineExecution(value: unknown): value is ActiveRoutineExecution {
  if (typeof value !== "object" || value === null) return false;
  const active = value as Record<string, unknown>;
  return typeof active.id === "string" && active.id.length > 0 &&
    typeof active.routineId === "string" && active.routineId.length > 0 &&
    typeof active.name === "string" && typeof active.startedAt === "string" &&
    Number.isSafeInteger(active.taskIndex) && Number(active.taskIndex) >= 0 &&
    typeof active.snapshots === "object" && active.snapshots !== null &&
    Object.values(active.snapshots as Record<string, unknown>)
      .every((snapshot) => typeof snapshot === "boolean") &&
    (active.holding === undefined || typeof active.holding === "boolean") &&
    (active.resumeAt === undefined || typeof active.resumeAt === "string");
}

function isRoutineRuntimeState(value: unknown): value is RoutineRuntimeState {
  if (typeof value !== "object" || value === null) return false;
  const routines = value as Record<string, unknown>;
  return Array.isArray(routines.definitions) && routines.definitions.length <= 100 &&
    routines.definitions.every(isRoutineDefinition) &&
    (routines.active === null || isActiveRoutineExecution(routines.active));
}

export type CommandStatus =
  | "pending"
  | "accepted"
  | "completed"
  | "failed";

export interface ApiErrorResponse {
  error: string;
  code?: string;
  commandId?: CommandId;
}

export interface CommandRequest {
  commandId: CommandId;
}

export interface SetEquipmentPowerRequest extends CommandRequest {
  on: boolean;
}

export interface SetEquipmentSpeedRequest extends CommandRequest {
  percent: number;
}

export interface RunDoserCalibrationRequest extends CommandRequest {
  runtimeSeconds: 60 | 300 | 600;
}

export type EquipmentOperationalState =
  | "off"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "unknown"
  | "disconnected";

export interface EquipmentListResponse {
  equipment: Equipment[];
}

export interface EquipmentResponse {
  equipment: Equipment;
}

export interface EquipmentCommandResponse extends EquipmentResponse {
  commandId: CommandId;
  status: "accepted" | "completed";
  replayed: boolean;
  operationalState?: EquipmentOperationalState;
  message?: string;
}

export type EdgeHealthStatus =
  | "healthy"
  | "degraded"
  | "unhealthy";

export type EdgeHealthCheckName =
  | "database"
  | "automation"
  | "clock"
  | "storage"
  | "equipment";

export interface EdgeHealthCheck {
  name: EdgeHealthCheckName;
  status: EdgeHealthStatus;
  message: string;
}

export interface EdgeHealthResponse {
  name: string;
  version: string;
  status: EdgeHealthStatus;
  checks: EdgeHealthCheck[];
  hostname: string;
  timestamp: string;
  uptimeSeconds: number;
  claimed?: boolean;
  setupId?: string;
  edgeId?: string;
  aquariumId?: string;
}

export function isCommandId(value: unknown): value is CommandId {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function isNamedResourceRequest(
  value: unknown,
): value is CreateAquariumRequest | RegisterEdgeRequest {
  if (typeof value !== "object" || value === null || !("name" in value)) return false;
  return typeof value.name === "string" && value.name.trim().length >= 1 && value.name.trim().length <= 100;
}

export function isCloudCommandRequest(value: unknown): value is CloudCommandRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCommandId(candidate.commandId) &&
    typeof candidate.edgeId === "string" && candidate.edgeId.length > 0 &&
    typeof candidate.equipmentId === "string" && candidate.equipmentId.length > 0 &&
    typeof candidate.type === "string" && candidate.type.length > 0 &&
    typeof candidate.payload === "object" && candidate.payload !== null && !Array.isArray(candidate.payload)
  );
}

export function isSetEquipmentPowerRequest(
  value: unknown,
): value is SetEquipmentPowerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "commandId" in value &&
    isCommandId(value.commandId) &&
    "on" in value &&
    typeof value.on === "boolean"
  );
}

export function isSetEquipmentSpeedRequest(
  value: unknown,
): value is SetEquipmentSpeedRequest {
  return typeof value === "object" && value !== null &&
    "commandId" in value && isCommandId(value.commandId) &&
    "percent" in value && Number.isInteger(value.percent) &&
    Number(value.percent) >= 0 && Number(value.percent) <= 100;
}

export function isRunDoserCalibrationRequest(
  value: unknown,
): value is RunDoserCalibrationRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "commandId" in value &&
    isCommandId(value.commandId) &&
    "runtimeSeconds" in value &&
    (value.runtimeSeconds === 60 ||
      value.runtimeSeconds === 300 ||
      value.runtimeSeconds === 600)
  );
}
