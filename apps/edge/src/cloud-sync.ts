import type {
  CloudCommand,
  EdgeCommandResult,
  EdgeSyncEvent,
  EdgeSyncRequest,
  EdgeSyncResponse,
} from "@modreef/api-contract";
import { hostname, networkInterfaces } from "node:os";
import type { AquariumEventCursor } from "@modreef/storage-sqlite";
import type {
  AdvancedOutletProgram,
  AquariumEvent,
  Equipment,
  EquipmentControlMode,
  EquipmentDisplaySetting,
  DoserCalibration,
  DosingParameter,
  EquipmentIntervalProgram,
  EquipmentProgramType,
  EquipmentRole,
  EquipmentSchedule,
  EquipmentSpeedSchedule,
  WavemakerLinkRole,
  WavemakerMode,
  WavemakerModeSettings,
  WaterProbeCalibration,
} from "@modreef/digital-twin";
import {
  runtimeStore,
  getEquipmentChannelStates,
  getTwin,
  updateEquipmentConfiguration,
  updateAdvancedOutletProgram,
  updateEquipmentDisplay,
  updateEquipmentLayout,
  updateEquipmentControlMode,
  updateDoserCalibration,
  updateEquipmentIntervalProgram,
  updateEquipmentProgramType,
  updateEquipmentSchedule,
  updateEquipmentSpeedSchedule,
  startEquipmentDose,
  setEquipmentSpeed,
  renamePhysicalDevice,
  deletePhysicalDevice,
  cloneEquipmentConfiguration,
  swapEquipmentBindings,
  updateWavemakerConfiguration,
  updateWaterProbeCalibration,
} from "./equipment-runtime.js";
import {
  getControllerUpdateStatus,
  requestControllerUpdate,
  setControllerReleaseChannel,
  type ControllerReleaseChannel,
} from "./controller-update.js";
import { isWaterProbeCalibration } from "./yinmik-water-equipment.js";
import {
  getPublicEquipmentSnapshot,
  isDoserCalibration,
  isEquipmentIntervalProgram,
  isEquipmentSchedule,
  isEquipmentSpeedSchedule,
} from "./equipment-api.js";
import { isAdvancedOutletProgram } from "@modreef/digital-twin";
import { createAquariumEvent } from "./timeline-api.js";
import { loadCloudCredentials } from "./cloud-credential-store.js";
import { completeFeedMode, getActiveFeedMode, startFeedMode } from "./automation-runtime.js";

export interface EdgeCloudConfig {
  cloudUrl: string;
  edgeId: string;
  aquariumId: string;
  token: string;
  intervalMilliseconds?: number;
}

interface SyncState {
  nextSequence: number;
  cursor?: AquariumEventCursor;
  pendingEvents: EdgeSyncEvent[];
  pendingCursor?: AquariumEventCursor;
  commandResults: EdgeCommandResult[];
}

const transientCommandTypes = new Set([
  "controller.check-for-update",
  "automation.feed-cycle.start",
  "automation.feed-cycle.stop",
  "equipment.run-doser-calibration",
  "equipment.set-control-mode",
  "equipment.set-power",
  "equipment.set-speed",
  "equipment.set-wavemaker-configuration",
]);
const transientCommandLifetimeMilliseconds = 2 * 60 * 1_000;

export interface EdgeCloudTransport {
  exchange(request: EdgeSyncRequest): Promise<EdgeSyncResponse>;
}

export interface EdgeCloudDependencies {
  loadState<T>(key: string): T | undefined;
  saveState<T>(key: string, value: T): void;
  listEventsAfter(aquariumId: string, cursor: AquariumEventCursor | undefined, limit: number): AquariumEvent[];
  getAquariumId(): string;
  getDevices?(): NonNullable<EdgeSyncRequest["devices"]>[number]["document"][];
  getEquipment(): Promise<Equipment[]>;
  getRuntimeState?(): EdgeSyncRequest["runtimeState"];
  executeControlMode(
    commandId: string,
    equipmentId: string,
    mode: EquipmentControlMode,
  ): Promise<unknown>;
  executeConfiguration(
    commandId: string,
    equipmentId: string,
    name: string,
    role: EquipmentRole,
    automaticRestartDelaySeconds?: number,
    dosingParameter?: DosingParameter,
    dosingParameterName?: string,
  ): Promise<unknown>;
  executeDisplay?(commandId: string, equipmentId: string, displayOrder: number, hidden: boolean): Promise<unknown>;
  executeLayout?(commandId: string, settings: EquipmentDisplaySetting[]): Promise<unknown>;
  executeProgramType(
    commandId: string,
    equipmentId: string,
    programType: EquipmentProgramType,
  ): Promise<unknown>;
  executeSchedule?(commandId: string, equipmentId: string, schedule: EquipmentSchedule): Promise<unknown>;
  executeSpeedSchedule?(commandId: string, equipmentId: string, schedule: EquipmentSpeedSchedule): Promise<unknown>;
  executeIntervalProgram?(commandId: string, equipmentId: string, program: EquipmentIntervalProgram): Promise<unknown>;
  executeAdvancedProgram?(commandId: string, equipmentId: string, program: AdvancedOutletProgram): Promise<unknown>;
  executeDoserCalibration?(commandId: string, equipmentId: string, calibration: DoserCalibration): Promise<unknown>;
  executeDoserCalibrationRun?(commandId: string, equipmentId: string, runtimeSeconds: 60 | 300 | 600): Promise<unknown>;
  executeSpeed?(commandId: string, equipmentId: string, percent: number): Promise<unknown>;
  executeWavemakerConfiguration?(commandId: string, equipmentId: string, feedCycleParticipation: boolean, linkRole: WavemakerLinkRole, mode: WavemakerMode, modeSettings?: WavemakerModeSettings): Promise<unknown>;
  executeWaterProbeCalibration?(commandId: string, equipmentId: string, calibration: WaterProbeCalibration): Promise<unknown>;
  executeCreateEvent(
    commandId: string,
    eventId: string,
    input: unknown,
  ): Promise<AquariumEvent>;
  executeUpdateEvent(commandId: string, eventId: string, input: unknown): Promise<AquariumEvent>;
  executeDeleteEvent(commandId: string, eventId: string): Promise<void>;
  executeRenameDevice?(commandId: string, deviceId: string, name: string): Promise<unknown>;
  executeDeleteDevice?(commandId: string, deviceId: string): Promise<unknown>;
  executeCloneEquipment?(
    commandId: string,
    sourceEquipmentId: string,
    destinationEquipmentId: string,
    name: string,
  ): Promise<unknown>;
  executeSwapEquipment?(
    commandId: string,
    equipmentId: string,
    otherEquipmentId: string,
  ): Promise<unknown>;
  executeStartFeedMode?(commandId: string, durationSeconds: number, skimmerRestartDelaySeconds: number, cycleId?: "A" | "B" | "C"): Promise<unknown>;
  executeStopFeedMode?(commandId: string): Promise<unknown>;
  executeControllerUpdateCheck?(commandId: string): Promise<unknown>;
  executeControllerReleaseChannel?(commandId: string, channel: ControllerReleaseChannel): Promise<unknown>;
  uptimeSeconds(): number;
}

const defaultDependencies: EdgeCloudDependencies = {
  loadState: (key) => runtimeStore.loadState(key),
  saveState: (key, value) => runtimeStore.saveState(key, value),
  listEventsAfter: (aquariumId, cursor, limit) => runtimeStore.listEventsAfter(aquariumId, cursor, limit),
  getAquariumId: () => getTwin().aquarium.id,
  getDevices: () => getTwin().devices ?? [],
  // Cloud command delivery must never wait on live device telemetry. The
  // equipment runtime continuously maintains this cached snapshot; a slow or
  // unreachable outlet must not stall the entire Edge-to-Cloud sync loop.
  getEquipment: async () => {
    // Keep cloud snapshots current without making command delivery wait for a
    // slow or temporarily unreachable device. The runtime de-duplicates
    // overlapping refreshes and retains the last valid values on failure.
    void getEquipmentChannelStates().catch((error) => {
      console.warn(
        "Could not refresh cloud equipment telemetry:",
        error instanceof Error ? error.message : error,
      );
    });
    return getPublicEquipmentSnapshot();
  },
  getRuntimeState: () => {
    const feedCycle = getActiveFeedMode();
    return {
      feedCycle: feedCycle ? {
        id: feedCycle.id,
        status: feedCycle.phase,
        startedAt: feedCycle.startedAt,
        endsAt: feedCycle.endsAt,
        durationSeconds: feedCycle.durationSeconds,
        ...(feedCycle.cycleId ? { cycleId: feedCycle.cycleId } : {}),
        ...(feedCycle.recoveryEndsAt ? { recoveryEndsAt: feedCycle.recoveryEndsAt } : {}),
      } : null,
      controllerUpdate: getControllerUpdateStatus(),
    };
  },
  executeControlMode: async (_commandId, equipmentId, mode) =>
    updateEquipmentControlMode(equipmentId, mode),
  executeConfiguration: async (_commandId, equipmentId, name, role, delay, dosingParameter, dosingParameterName) =>
    updateEquipmentConfiguration(
      equipmentId, name, role, delay, dosingParameter, dosingParameterName,
    ),
  executeDisplay: async (_commandId, equipmentId, displayOrder, hidden) =>
    updateEquipmentDisplay(equipmentId, displayOrder, hidden),
  executeLayout: async (_commandId, settings) => updateEquipmentLayout(settings),
  executeProgramType: async (_commandId, equipmentId, programType) =>
    updateEquipmentProgramType(equipmentId, programType),
  executeSchedule: async (_commandId, equipmentId, schedule) =>
    updateEquipmentSchedule(equipmentId, schedule),
  executeSpeedSchedule: async (_commandId, equipmentId, schedule) =>
    updateEquipmentSpeedSchedule(equipmentId, schedule),
  executeIntervalProgram: async (_commandId, equipmentId, program) =>
    updateEquipmentIntervalProgram(equipmentId, program),
  executeAdvancedProgram: async (_commandId, equipmentId, program) =>
    updateAdvancedOutletProgram(equipmentId, program),
  executeDoserCalibration: async (_commandId, equipmentId, calibration) =>
    updateDoserCalibration(equipmentId, calibration),
  executeDoserCalibrationRun: async (_commandId, equipmentId, runtimeSeconds) => {
    await updateEquipmentControlMode(equipmentId, "off");
    return startEquipmentDose(equipmentId, runtimeSeconds, {
      action: "doser-calibration-started",
      details: `${runtimeSeconds}-second calibration run started from cloud control`,
    });
  },
  executeSpeed: async (_commandId, equipmentId, percent) => setEquipmentSpeed(equipmentId, percent),
  executeWavemakerConfiguration: async (_commandId, equipmentId, participation, role, mode, modeSettings) =>
    updateWavemakerConfiguration(equipmentId, participation, role, mode, modeSettings),
  executeWaterProbeCalibration: async (_commandId, equipmentId, calibration) =>
    updateWaterProbeCalibration(equipmentId, calibration),
  executeCreateEvent: async (_commandId, eventId, input) => {
    const event = {
      ...createAquariumEvent(getTwin().aquarium.id, input),
      id: eventId,
    } as AquariumEvent;
    runtimeStore.appendEvent(event);
    return event;
  },
  executeUpdateEvent: async (_commandId, eventId, input) => {
    const event = {
      ...createAquariumEvent(getTwin().aquarium.id, input),
      id: eventId,
    } as AquariumEvent;
    if (!runtimeStore.updateEvent(event)) throw new Error("Event not found");
    return event;
  },
  executeDeleteEvent: async (_commandId, eventId) => {
    if (!runtimeStore.deleteEvent(getTwin().aquarium.id, eventId)) {
      throw new Error("Event not found");
    }
  },
  executeRenameDevice: async (_commandId, deviceId, name) =>
    renamePhysicalDevice(deviceId, name),
  executeDeleteDevice: async (_commandId, deviceId) =>
    deletePhysicalDevice(deviceId),
  executeCloneEquipment: async (_commandId, sourceId, destinationId, name) =>
    cloneEquipmentConfiguration(sourceId, destinationId, name),
  executeSwapEquipment: async (_commandId, equipmentId, otherEquipmentId) =>
    swapEquipmentBindings(equipmentId, otherEquipmentId),
  executeControllerUpdateCheck: async () => requestControllerUpdate(),
  executeControllerReleaseChannel: async (_commandId, channel) =>
    setControllerReleaseChannel(channel),
  executeStartFeedMode: async (_commandId, durationSeconds, skimmerRestartDelaySeconds, cycleId) =>
    startFeedMode(durationSeconds, skimmerRestartDelaySeconds, cycleId),
  executeStopFeedMode: async () => completeFeedMode("cancelled"),
  uptimeSeconds: () => Math.floor(process.uptime()),
};

const stateKey = "cloud-sync-v1";
export const waterAlarmSettingsStateKey = "water-alarm-settings-v1";
const defaultSyncIntervalMilliseconds = 2_000;

function isWavemakerModeSettings(value: unknown): value is WavemakerModeSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([mode, setting]) => {
    if (!["M1", "M2", "M3", "M4", "M5"].includes(mode) ||
      typeof setting !== "object" || setting === null || Array.isArray(setting)) return false;
    const candidate = setting as Record<string, unknown>;
    return typeof candidate.flowPercent === "number" &&
      candidate.flowPercent >= 30 && candidate.flowPercent <= 100 &&
      (mode === "M4" ||
        (typeof candidate.pulseFrequency === "number" &&
          candidate.pulseFrequency >= 5 && candidate.pulseFrequency <= 100));
  });
}

function localIpv4Address(): string | undefined {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find((address) =>
      address.family === "IPv4" &&
      !address.internal &&
      !address.address.startsWith("169.254.")
    )?.address;
}

class FetchEdgeCloudTransport implements EdgeCloudTransport {
  constructor(private readonly config: EdgeCloudConfig) {}
  async exchange(body: EdgeSyncRequest): Promise<EdgeSyncResponse> {
    const response = await fetch(`${this.config.cloudUrl.replace(/\/$/, "")}/v1/edge/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Cloud sync returned HTTP ${response.status}`);
    return await response.json() as EdgeSyncResponse;
  }
}

export class EdgeCloudSync {
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: EdgeCloudConfig,
    private readonly transport: EdgeCloudTransport = new FetchEdgeCloudTransport(config),
    private readonly dependencies: EdgeCloudDependencies = defaultDependencies,
  ) {}

  start(): void {
    void this.runOnce();
    this.timer = setInterval(
      () => void this.runOnce(),
      this.config.intervalMilliseconds ?? defaultSyncIntervalMilliseconds,
    );
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let reportCommandResultsImmediately = false;
    try {
      const state = this.loadState();
      this.prepareEvents(state);
      this.dependencies.saveState(stateKey, state);
      const equipment = await this.dependencies.getEquipment();
      const reportedAt = new Date().toISOString();
      const localAddress = localIpv4Address();
      const response = await this.transport.exchange({
        edgeId: this.config.edgeId,
        aquariumId: this.config.aquariumId,
        softwareVersion: "0.1.0",
        uptimeSeconds: this.dependencies.uptimeSeconds(),
        localHostname: hostname(),
        ...(localAddress ? { localAddress } : {}),
        devices: (this.dependencies.getDevices?.() ?? []).map((document) => ({
          deviceId: document.id,
          edgeId: this.config.edgeId,
          document,
          reportedAt,
        })),
        equipment: equipment.map((document) => ({
          equipmentId: document.id,
          edgeId: this.config.edgeId,
          document,
          reportedAt,
        })),
        events: state.pendingEvents,
        commandResults: state.commandResults,
        runtimeState: this.dependencies.getRuntimeState?.() ?? { feedCycle: null },
      });
      const finalSequence = state.pendingEvents.at(-1)?.sequence ?? 0;
      if (finalSequence === 0 || response.acceptedThroughSequence >= finalSequence) {
        if (state.pendingCursor) state.cursor = state.pendingCursor;
        state.pendingEvents = [];
        delete state.pendingCursor;
      }
      const accepted = new Set(response.acceptedCommandIds);
      if (response.waterAlarmSettings) {
        this.dependencies.saveState(waterAlarmSettingsStateKey, response.waterAlarmSettings);
      }
      state.commandResults = state.commandResults.filter((item) => !accepted.has(item.commandId));
      this.dependencies.saveState(stateKey, state);
      const resultCountBeforeCommands = state.commandResults.length;
      for (const command of response.commands) {
        await this.executeCommand(command, state, response.serverTime);
      }
      this.dependencies.saveState(stateKey, state);
      reportCommandResultsImmediately =
        state.commandResults.length > resultCountBeforeCommands;
    } catch (error) {
      console.warn("Cloud sync deferred; local control remains available:", error instanceof Error ? error.message : error);
    } finally {
      this.running = false;
      if (reportCommandResultsImmediately) {
        const followUp = setTimeout(() => void this.runOnce(), 0);
        followUp.unref();
      }
    }
  }

  private loadState(): SyncState {
    return this.dependencies.loadState<SyncState>(stateKey) ?? {
      nextSequence: 1,
      pendingEvents: [],
      commandResults: [],
    };
  }

  private prepareEvents(state: SyncState): void {
    if (state.pendingEvents.length > 0) return;
    const aquariumId = this.dependencies.getAquariumId();
    const events = this.dependencies.listEventsAfter(aquariumId, state.cursor, 100);
    state.pendingEvents = events.map((event, index) => ({
      eventId: event.id,
      sequence: state.nextSequence + index,
      type: event.type,
      occurredAt: event.occurredAt,
      document: event,
    }));
    state.nextSequence += events.length;
    const last = events.at(-1);
    if (last) state.pendingCursor = { recordedAt: last.recordedAt, eventId: last.id };
  }

  private async executeCommand(
    command: CloudCommand,
    state: SyncState,
    serverTime: string,
  ): Promise<void> {
    if (state.commandResults.some((item) => item.commandId === command.commandId)) return;
    const createdAt = Date.parse(command.createdAt);
    const referenceTime = Date.parse(serverTime);
    if (
      transientCommandTypes.has(command.type) &&
      Number.isFinite(createdAt) &&
      Number.isFinite(referenceTime) &&
      referenceTime - createdAt > transientCommandLifetimeMilliseconds
    ) {
      state.commandResults.push({
        commandId: command.commandId,
        status: "failed",
        message: "Operational command expired before execution",
      });
      this.dependencies.saveState(stateKey, state);
      console.warn(`Skipped expired cloud command ${command.commandId}: ${command.type}`);
      return;
    }
    console.info(
      `Executing cloud command ${command.commandId}: ${command.type} for ${command.equipmentId}`,
    );
    let result: EdgeCommandResult;
    try {
      if (command.type === "controller.check-for-update") {
        if (!this.dependencies.executeControllerUpdateCheck) {
          throw new Error("Controller update checks are unavailable");
        }
        await this.dependencies.executeControllerUpdateCheck(command.commandId);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "controller.set-release-channel") {
        if (!this.dependencies.executeControllerReleaseChannel) {
          throw new Error("Controller release channel selection is unavailable");
        }
        const channel = command.payload.channel;
        if (channel !== "production" && channel !== "staging") {
          throw new Error("Invalid controller release channel");
        }
        await this.dependencies.executeControllerReleaseChannel(command.commandId, channel);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "aquarium.event.create") {
        const eventId = command.payload.eventId;
        const input = command.payload.event;
        if (typeof eventId !== "string" || eventId.length < 8 || input === undefined) {
          throw new Error("Invalid aquarium event command");
        }
        await this.dependencies.executeCreateEvent(command.commandId, eventId, input);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "aquarium.event.update") {
        const eventId = command.payload.eventId;
        const input = command.payload.event;
        if (typeof eventId !== "string" || eventId.length < 1 || input === undefined) {
          throw new Error("Invalid aquarium event update command");
        }
        await this.dependencies.executeUpdateEvent(command.commandId, eventId, input);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "aquarium.event.delete") {
        const eventId = command.payload.eventId;
        if (typeof eventId !== "string" || eventId.length < 1) {
          throw new Error("Invalid aquarium event delete command");
        }
        await this.dependencies.executeDeleteEvent(command.commandId, eventId);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.update-configuration") {
        const name = command.payload.name;
        const role = command.payload.role;
        const automaticRestartDelaySeconds =
          command.payload.automaticRestartDelaySeconds;
        const dosingParameter = command.payload.dosingParameter;
        const dosingParameterName = command.payload.dosingParameterName;

        if (
          typeof name !== "string" ||
          name.trim() === "" ||
          name.trim().length > 48 ||
          !isEquipmentRole(role) ||
          (automaticRestartDelaySeconds !== undefined &&
            (!Number.isSafeInteger(automaticRestartDelaySeconds) ||
              Number(automaticRestartDelaySeconds) < 0 ||
              Number(automaticRestartDelaySeconds) > 1_800))
          || (dosingParameter !== undefined &&
            !isDosingParameter(dosingParameter))
          || (dosingParameterName !== undefined &&
            (typeof dosingParameterName !== "string" ||
              dosingParameterName.trim().length < 1 ||
              dosingParameterName.trim().length > 48))
          || (dosingParameter === "other" &&
            typeof dosingParameterName !== "string")
        ) {
          throw new Error("Invalid equipment configuration command");
        }

        await this.dependencies.executeConfiguration(
          command.commandId,
          command.equipmentId,
          name.trim(),
          role,
          automaticRestartDelaySeconds === undefined
            ? undefined
            : Number(automaticRestartDelaySeconds),
          dosingParameter === undefined ? undefined : dosingParameter,
          typeof dosingParameterName === "string"
            ? dosingParameterName.trim()
            : undefined,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.clone-configuration") {
        const destinationEquipmentId = command.payload.destinationEquipmentId;
        const name = command.payload.name;
        if (
          typeof destinationEquipmentId !== "string" ||
          destinationEquipmentId.length === 0 ||
          typeof name !== "string" || name.trim().length === 0 ||
          name.trim().length > 48 ||
          !this.dependencies.executeCloneEquipment
        ) {
          throw new Error("Invalid equipment clone command");
        }
        await this.dependencies.executeCloneEquipment(
          command.commandId, command.equipmentId,
          destinationEquipmentId, name.trim(),
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.swap-binding") {
        const otherEquipmentId = command.payload.otherEquipmentId;
        if (
          typeof otherEquipmentId !== "string" ||
          otherEquipmentId.length === 0 ||
          !this.dependencies.executeSwapEquipment
        ) {
          throw new Error("Invalid equipment binding swap command");
        }
        await this.dependencies.executeSwapEquipment(
          command.commandId, command.equipmentId, otherEquipmentId,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-water-calibration") {
        const calibration = command.payload.calibration;
        if (!isWaterProbeCalibration(calibration) ||
          !this.dependencies.executeWaterProbeCalibration) {
          throw new Error("Invalid water probe calibration command");
        }
        await this.dependencies.executeWaterProbeCalibration(
          command.commandId,
          command.equipmentId,
          calibration,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "managed-device.rename") {
        const deviceId = command.payload.deviceId;
        const name = command.payload.name;
        if (
          typeof deviceId !== "string" || deviceId.length === 0 ||
          typeof name !== "string" || name.trim().length === 0 ||
          name.trim().length > 48 || !this.dependencies.executeRenameDevice
        ) {
          throw new Error("Invalid managed device rename command");
        }
        await this.dependencies.executeRenameDevice(
          command.commandId, deviceId, name.trim(),
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "managed-device.delete") {
        const deviceId = command.payload.deviceId;
        if (
          typeof deviceId !== "string" || deviceId.length === 0 ||
          !this.dependencies.executeDeleteDevice
        ) {
          throw new Error("Invalid managed device delete command");
        }
        await this.dependencies.executeDeleteDevice(command.commandId, deviceId);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.update-display") {
        const displayOrder = command.payload.displayOrder;
        const hidden = command.payload.hiddenFromDashboard;
        if (!Number.isSafeInteger(displayOrder) || Number(displayOrder) < 0 ||
            typeof hidden !== "boolean" || !this.dependencies.executeDisplay) {
          throw new Error("Invalid equipment display command");
        }
        await this.dependencies.executeDisplay(
          command.commandId, command.equipmentId, Number(displayOrder), hidden,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.update-layout") {
        const settings = command.payload.settings;
        if (!Array.isArray(settings) || !settings.every(isEquipmentDisplaySetting) ||
            !this.dependencies.executeLayout) {
          throw new Error("Invalid equipment layout command");
        }
        await this.dependencies.executeLayout(command.commandId, settings);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-program-type") {
        const programType = command.payload.programType;

        if (!isEquipmentProgramType(programType)) {
          throw new Error("Invalid equipment program type command");
        }

        await this.dependencies.executeProgramType(
          command.commandId,
          command.equipmentId,
          programType,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-speed") {
        const percent = command.payload.percent;
        if (!Number.isInteger(percent) || Number(percent) < 0 || Number(percent) > 100 || !this.dependencies.executeSpeed) {
          throw new Error("Invalid equipment speed command");
        }
        await this.dependencies.executeSpeed(command.commandId, command.equipmentId, Number(percent));
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-schedule") {
        const schedule = command.payload.schedule;
        if (!isEquipmentSchedule(schedule) || !this.dependencies.executeSchedule) {
          throw new Error("Invalid equipment schedule command");
        }
        await this.dependencies.executeSchedule(command.commandId, command.equipmentId, schedule);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-speed-schedule") {
        const schedule = command.payload.speedSchedule;
        if (!isEquipmentSpeedSchedule(schedule) || !this.dependencies.executeSpeedSchedule) {
          throw new Error("Invalid equipment speed schedule command");
        }
        await this.dependencies.executeSpeedSchedule(command.commandId, command.equipmentId, schedule);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-wavemaker-configuration") {
        const participation = command.payload.feedCycleParticipation;
        const linkRole = command.payload.linkRole;
        const mode = command.payload.mode;
        const modeSettings = command.payload.modeSettings;
        if (typeof participation !== "boolean" ||
          !["independent", "master", "slave"].includes(String(linkRole)) ||
          !["M1", "M2", "M3", "M4", "M5"].includes(String(mode)) ||
          (modeSettings !== undefined && !isWavemakerModeSettings(modeSettings)) ||
          !this.dependencies.executeWavemakerConfiguration) {
          throw new Error("Invalid wavemaker configuration command");
        }
        await this.dependencies.executeWavemakerConfiguration(
          command.commandId, command.equipmentId, participation,
          linkRole as WavemakerLinkRole, mode as WavemakerMode, modeSettings,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-interval-program") {
        const program = command.payload.intervalProgram;
        if (!isEquipmentIntervalProgram(program) || !this.dependencies.executeIntervalProgram) {
          throw new Error("Invalid equipment interval program command");
        }
        await this.dependencies.executeIntervalProgram(command.commandId, command.equipmentId, program);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-advanced-program") {
        const program = command.payload.advancedOutletProgram;
        if (!isAdvancedOutletProgram(program) || !this.dependencies.executeAdvancedProgram) {
          throw new Error("Invalid advanced outlet program command");
        }
        await this.dependencies.executeAdvancedProgram(command.commandId, command.equipmentId, program);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.set-doser-calibration") {
        const calibration = command.payload.calibration;
        if (!isDoserCalibration(calibration) || !this.dependencies.executeDoserCalibration) {
          throw new Error("Invalid doser calibration command");
        }
        await this.dependencies.executeDoserCalibration(command.commandId, command.equipmentId, calibration);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "equipment.run-doser-calibration") {
        const runtimeSeconds = command.payload.runtimeSeconds;
        if (
          (runtimeSeconds !== 60 && runtimeSeconds !== 300 && runtimeSeconds !== 600) ||
          !this.dependencies.executeDoserCalibrationRun
        ) {
          throw new Error("Doser calibration run is unavailable");
        }
        await this.dependencies.executeDoserCalibrationRun(
          command.commandId,
          command.equipmentId,
          runtimeSeconds,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "automation.feed-cycle.start") {
        const durationSeconds = command.payload.durationSeconds;
        const skimmerRestartDelaySeconds = command.payload.skimmerRestartDelaySeconds;
        const cycleId = command.payload.cycleId;
        if (
          !Number.isSafeInteger(durationSeconds) || Number(durationSeconds) < 60 ||
          Number(durationSeconds) > 3_600 ||
          !Number.isSafeInteger(skimmerRestartDelaySeconds) ||
          Number(skimmerRestartDelaySeconds) < 0 ||
          Number(skimmerRestartDelaySeconds) > 1_800 ||
          (cycleId !== undefined && cycleId !== "A" && cycleId !== "B" && cycleId !== "C") ||
          !this.dependencies.executeStartFeedMode
        ) {
          throw new Error("Invalid Feed Cycle start command");
        }
        await this.dependencies.executeStartFeedMode(
          command.commandId,
          Number(durationSeconds),
          Number(skimmerRestartDelaySeconds),
          cycleId as "A" | "B" | "C" | undefined,
        );
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      if (command.type === "automation.feed-cycle.stop") {
        if (!this.dependencies.executeStopFeedMode) {
          throw new Error("Feed Cycle stop is unavailable");
        }
        await this.dependencies.executeStopFeedMode(command.commandId);
        result = { commandId: command.commandId, status: "completed" };
        state.commandResults.push(result);
        this.dependencies.saveState(stateKey, state);
        return;
      }

      const mode = command.type === "equipment.set-power" &&
          typeof command.payload.on === "boolean"
        ? command.payload.on ? "on" : "off"
        : command.type === "equipment.set-control-mode" &&
            (command.payload.mode === "off" ||
              command.payload.mode === "auto" ||
              command.payload.mode === "on")
          ? command.payload.mode
          : undefined;
      if (!mode) {
        throw new Error(`Unsupported cloud command: ${command.type}`);
      }
      await this.dependencies.executeControlMode(
        command.commandId,
        command.equipmentId,
        mode,
      );
      console.info(
        `Applied control mode ${mode.toUpperCase()} to ${command.equipmentId}`,
      );
      result = { commandId: command.commandId, status: "completed" };
    } catch (error) {
      result = { commandId: command.commandId, status: "failed", message: error instanceof Error ? error.message : String(error) };
    }
    state.commandResults.push(result);
    this.dependencies.saveState(stateKey, state);
    console.info(
      `Cloud command ${command.commandId} ${result.status}` +
        (result.message ? `: ${result.message}` : ""),
    );
  }
}

const equipmentRoles: EquipmentRole[] = [
  "return-pump",
  "circulation-pump",
  "heater",
  "light",
  "skimmer",
  "doser",
  "ato",
  "sensor",
  "outlet",
  "uv",
  "other",
];

function isEquipmentRole(value: unknown): value is EquipmentRole {
  return equipmentRoles.some((role) => role === value);
}

function isEquipmentDisplaySetting(value: unknown): value is EquipmentDisplaySetting {
  if (typeof value !== "object" || value === null) return false;
  const setting = value as Record<string, unknown>;
  return typeof setting.equipmentId === "string" && setting.equipmentId.length > 0 &&
    Number.isSafeInteger(setting.displayOrder) && Number(setting.displayOrder) >= 0 &&
    typeof setting.hiddenFromDashboard === "boolean";
}

const dosingParameters: DosingParameter[] = [
  "alkalinity", "calcium", "magnesium", "potassium",
  "iodine", "nitrate", "phosphate", "iron",
  "other",
];

function isDosingParameter(value: unknown): value is DosingParameter {
  return dosingParameters.some((parameter) => parameter === value);
}

const equipmentProgramTypes: EquipmentProgramType[] = [
  "always-on",
  "schedule",
  "light-schedule",
  "heater",
  "return-pump",
  "skimmer",
  "dosing-pump",
  "advanced",
];

function isEquipmentProgramType(
  value: unknown,
): value is EquipmentProgramType {
  return equipmentProgramTypes.some((type) => type === value);
}

export function createEdgeCloudSyncFromEnvironment(): EdgeCloudSync | undefined {
  const values = [process.env.MODREEF_CLOUD_URL, process.env.MODREEF_EDGE_ID,
    process.env.MODREEF_AQUARIUM_ID, process.env.MODREEF_EDGE_TOKEN];
  if (values.every((value) => !value)) {
    const stored = loadCloudCredentials();
    return stored ? new EdgeCloudSync(stored) : undefined;
  }
  if (values.some((value) => !value)) {
    console.warn("Cloud sync disabled: MODREEF_CLOUD_URL, MODREEF_EDGE_ID, MODREEF_AQUARIUM_ID, and MODREEF_EDGE_TOKEN must all be set");
    return undefined;
  }
  return new EdgeCloudSync({ cloudUrl: values[0]!, edgeId: values[1]!, aquariumId: values[2]!, token: values[3]! });
}
