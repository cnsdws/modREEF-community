import { describe, expect, it, vi } from "vitest";
import type {
  AquariumEvent as CloudAquariumEvent,
  AquariumSummary,
  CloudCommand,
  CloudCommandRequest,
  CloudDeviceSnapshot,
  CloudEquipmentSnapshot,
  EdgeSummary,
  EdgeSyncRequest,
  EdgeSyncResponse,
  WaterAlarmRules,
  WaterAlarmSettings,
} from "@modreef/api-contract";
import type { AquariumEvent } from "@modreef/digital-twin";

import { CloudApplication } from "../../cloud-api/src/application.js";
import type {
  Authenticator,
  CloudRepository,
  Identity,
} from "../../cloud-api/src/types.js";
import {
  EdgeCloudSync,
  type EdgeCloudDependencies,
  type EdgeCloudTransport,
} from "../../edge/src/cloud-sync.js";

const aquariumId = "reef-system-test";
const edgeId = "edge-system-test";
const edgeToken = "edge-system-token";
const userToken = "owner-system-token";

class TestAuthenticator implements Authenticator {
  async authenticate(authorization: string | undefined): Promise<Identity | null> {
    return authorization === `Bearer ${userToken}` ? { subject: "owner" } : null;
  }
}

class InMemoryCloudRepository implements CloudRepository {
  readonly commands = new Map<string, CloudCommand>();
  readonly events = new Map<string, CloudAquariumEvent>();
  readonly equipment = new Map<string, CloudEquipmentSnapshot>();
  waterAlarmSettings: WaterAlarmSettings | undefined;

  async checkReadiness() {}
  async listAquariums(): Promise<AquariumSummary[]> {
    return [{ id: aquariumId, name: "System Test Reef", role: "owner", createdAt: "2026-07-29T00:00:00Z" }];
  }
  async listArchivedAquariums(): Promise<AquariumSummary[]> {
    return [];
  }
  async createAquarium(): Promise<AquariumSummary> {
    return { id: aquariumId, name: "System Test Reef", role: "owner", createdAt: "2026-07-29T00:00:00Z" };
  }
  async getAquarium(_identity: Identity, requestedAquariumId: string): Promise<AquariumSummary | null> {
    return requestedAquariumId === aquariumId
      ? { id: aquariumId, name: "System Test Reef", role: "owner", createdAt: "2026-07-29T00:00:00Z" }
      : null;
  }
  async renameAquarium(
    _identity: Identity,
    requestedAquariumId: string,
    name: string,
  ): Promise<AquariumSummary | null> {
    return requestedAquariumId === aquariumId
      ? { id: aquariumId, name, role: "owner", createdAt: "2026-07-29T00:00:00Z" }
      : null;
  }
  async archiveAquarium() {
    return { status: "blocked" as const, controllerIds: [edgeId] };
  }
  async restoreAquarium(): Promise<AquariumSummary | null> {
    return null;
  }
  async listEdges(_identity: Identity, requestedAquariumId: string): Promise<EdgeSummary[] | null> {
    return requestedAquariumId === aquariumId
      ? [{ id: edgeId, aquariumId, name: "System Test Controller", status: "online", softwareVersion: "0.1.0", lastSeenAt: "2026-07-29T00:00:00Z", localHostname: "system-test", runtimeState: { feedCycle: null } }]
      : null;
  }
  async renameEdge(
    _identity: Identity,
    requestedAquariumId: string,
    requestedEdgeId: string,
    name: string,
  ): Promise<EdgeSummary | null> {
    return requestedAquariumId === aquariumId && requestedEdgeId === edgeId
      ? { id: edgeId, aquariumId, name, status: "online", softwareVersion: "0.1.0", lastSeenAt: "2026-07-29T00:00:00Z", localHostname: "system-test", runtimeState: { feedCycle: null } }
      : null;
  }
  async retireEdge() {
    return null;
  }
  async reprovisionEdge(_identity: Identity, requestedAquariumId: string, requestedEdgeId: string) {
    return { edgeId: requestedEdgeId, aquariumId: requestedAquariumId, token: "r".repeat(43) };
  }
  async createLocalAuthorization(
    _identity: Identity,
    requestedAquariumId: string,
    requestedEdgeId: string,
  ) {
    return requestedAquariumId === aquariumId && requestedEdgeId === edgeId
      ? { grant: "signed-grant", expiresAt: "2026-07-29T00:01:00Z" }
      : null;
  }
  async listEquipment(_identity: Identity, requestedAquariumId: string): Promise<CloudEquipmentSnapshot[] | null> {
    return requestedAquariumId === aquariumId ? [...this.equipment.values()] : null;
  }
  async listDevices(_identity: Identity, requestedAquariumId: string): Promise<CloudDeviceSnapshot[] | null> {
    return requestedAquariumId === aquariumId ? [] : null;
  }
  async listEvents(_identity: Identity, requestedAquariumId: string, limit: number): Promise<CloudAquariumEvent[] | null> {
    return requestedAquariumId === aquariumId
      ? [...this.events.values()].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit)
      : null;
  }
  async getWaterAlarmSettings(_identity: Identity, requestedAquariumId: string) {
    return requestedAquariumId === aquariumId ? this.waterAlarmSettings : null;
  }
  async saveWaterAlarmSettings(
    _identity: Identity,
    requestedAquariumId: string,
    rules: WaterAlarmRules,
  ) {
    if (requestedAquariumId !== aquariumId) return null;
    this.waterAlarmSettings = {
      aquariumId,
      rules,
      revision: (this.waterAlarmSettings?.revision ?? 0) + 1,
      updatedAt: "2026-08-10T12:00:00Z",
    };
    return this.waterAlarmSettings;
  }
  async createCommand(_identity: Identity, requestedAquariumId: string, request: CloudCommandRequest): Promise<CloudCommand | null> {
    if (requestedAquariumId !== aquariumId) return null;
    const existing = this.commands.get(request.commandId);
    if (existing) return existing;
    const command: CloudCommand = {
      ...request,
      aquariumId,
      status: "queued",
      createdAt: "2026-07-29T00:00:00Z",
    };
    this.commands.set(command.commandId, command);
    return command;
  }
  async getCommand(
    _identity: Identity,
    requestedAquariumId: string,
    commandId: string,
  ): Promise<CloudCommand | null> {
    if (requestedAquariumId !== aquariumId) return null;
    return this.commands.get(commandId) ?? null;
  }
  async registerEdge() {
    return { edgeId, aquariumId, token: edgeToken };
  }
  async synchronizeEdge(token: string, request: EdgeSyncRequest): Promise<EdgeSyncResponse | null> {
    if (token !== edgeToken || request.edgeId !== edgeId || request.aquariumId !== aquariumId) return null;

    for (const snapshot of request.equipment) this.equipment.set(snapshot.equipmentId, structuredClone(snapshot));
    for (const event of request.events) {
      this.events.set(event.eventId, {
        ...event,
        aquariumId,
        edgeId,
      });
    }

    const acceptedCommandIds: string[] = [];
    for (const result of request.commandResults) {
      const command = this.commands.get(result.commandId);
      if (!command) continue;
      this.commands.set(result.commandId, {
        ...command,
        status: result.status,
      });
      acceptedCommandIds.push(result.commandId);
    }

    const commands = [...this.commands.values()]
      .filter((command) => command.status === "queued" || command.status === "delivered")
      .map((command) => {
        const delivered = { ...command, status: "delivered" as const };
        this.commands.set(command.commandId, delivered);
        return delivered;
      });

    return {
      acceptedThroughSequence: request.events.at(-1)?.sequence ?? 0,
      acceptedCommandIds,
      commands,
      serverTime: "2026-07-29T00:00:01Z",
      ...(this.waterAlarmSettings ? { waterAlarmSettings: this.waterAlarmSettings } : {}),
    };
  }
}

function event(id: string, timestamp: string): AquariumEvent {
  return {
    id,
    aquariumId,
    type: "activity",
    category: "equipment",
    action: "configuration-changed",
    title: "Outlet configuration updated",
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: "manual",
    equipmentId: "outlet-1",
  };
}

function createSystem() {
  const repository = new InMemoryCloudRepository();
  const cloud = new CloudApplication(repository, new TestAuthenticator());
  const state = new Map<string, unknown>();
  const localEvents: AquariumEvent[] = [];
  const handlers = {
    controlMode: vi.fn(async (..._arguments: unknown[]) => undefined),
    configuration: vi.fn(async (..._arguments: unknown[]) => undefined),
    display: vi.fn(async (..._arguments: unknown[]) => undefined),
    programType: vi.fn(async (..._arguments: unknown[]) => undefined),
    schedule: vi.fn(async (..._arguments: unknown[]) => undefined),
    intervalProgram: vi.fn(async (..._arguments: unknown[]) => undefined),
    advancedProgram: vi.fn(async (..._arguments: unknown[]) => undefined),
    calibration: vi.fn(async (..._arguments: unknown[]) => undefined),
    calibrationRun: vi.fn(async (..._arguments: unknown[]) => undefined),
  };
  const dependencies: EdgeCloudDependencies = {
    loadState: (key) => state.get(key) as never,
    saveState: (key, value) => state.set(key, structuredClone(value)),
    listEventsAfter: (_requestedAquariumId, cursor, limit) => localEvents
      .filter((item) => !cursor || item.recordedAt > cursor.recordedAt || (item.recordedAt === cursor.recordedAt && item.id > cursor.eventId))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))
      .slice(0, limit),
    getAquariumId: () => aquariumId,
    getEquipment: async () => [{ id: "outlet-1", name: "Doser", role: "doser", enabled: false } as never],
    executeControlMode: (_commandId, equipmentIdValue, mode) => handlers.controlMode(equipmentIdValue, mode),
    executeConfiguration: (_commandId, equipmentIdValue, name, role) => handlers.configuration(equipmentIdValue, name, role),
    executeDisplay: (_commandId, equipmentIdValue, order, hidden) => handlers.display(equipmentIdValue, order, hidden),
    executeProgramType: (_commandId, equipmentIdValue, programType) => handlers.programType(equipmentIdValue, programType),
    executeSchedule: (_commandId, equipmentIdValue, schedule) => handlers.schedule(equipmentIdValue, schedule),
    executeIntervalProgram: (_commandId, equipmentIdValue, program) => handlers.intervalProgram(equipmentIdValue, program),
    executeAdvancedProgram: (_commandId, equipmentIdValue, program) => handlers.advancedProgram(equipmentIdValue, program),
    executeDoserCalibration: (_commandId, equipmentIdValue, calibration) => handlers.calibration(equipmentIdValue, calibration),
    executeDoserCalibrationRun: (_commandId, equipmentIdValue, runtimeSeconds) => handlers.calibrationRun(equipmentIdValue, runtimeSeconds),
    executeCreateEvent: async () => event("created-event", "2026-07-29T01:00:00Z"),
    executeUpdateEvent: async () => event("updated-event", "2026-07-29T01:00:00Z"),
    executeDeleteEvent: async () => undefined,
    uptimeSeconds: () => 10,
  };
  const transport: EdgeCloudTransport = {
    exchange: async (body) => {
      const response = await cloud.handle({
        method: "POST",
        path: "/v1/edge/sync",
        authorization: `Bearer ${edgeToken}`,
        body,
      });
      if (response.status !== 200) throw new Error(`Cloud sync returned ${response.status}`);
      return response.body as EdgeSyncResponse;
    },
  };
  const config = { cloudUrl: "https://system.test", edgeId, aquariumId, token: edgeToken };
  return { repository, cloud, state, localEvents, handlers, dependencies, transport, config };
}

async function queueCommand(cloud: CloudApplication, request: CloudCommandRequest) {
  const response = await cloud.handle({
    method: "POST",
    path: `/v1/aquariums/${aquariumId}/commands`,
    authorization: `Bearer ${userToken}`,
    body: request,
  });
  expect(response.status).toBe(202);
}

describe("Edge and Cloud regression workflows", () => {
  it("persists journal events across an Edge restart without gaps or duplicates", async () => {
    const system = createSystem();
    system.localEvents.push(
      event("event-0001", "2026-07-29T00:00:01Z"),
      event("event-0002", "2026-07-29T00:00:02Z"),
    );

    await new EdgeCloudSync(system.config, system.transport, system.dependencies).runOnce();
    system.localEvents.push(event("event-0003", "2026-07-29T00:00:03Z"));

    // A new synchronizer uses the same durable state, simulating a service restart.
    await new EdgeCloudSync(system.config, system.transport, system.dependencies).runOnce();

    const response = await system.cloud.handle({
      method: "GET",
      path: `/v1/aquariums/${aquariumId}/events`,
      authorization: `Bearer ${userToken}`,
    });
    expect(response.status).toBe(200);
    expect((response.body as { events: CloudAquariumEvent[] }).events.map((item) => item.eventId))
      .toEqual(["event-0003", "event-0002", "event-0001"]);
  });

  it("delivers every equipment command and receives the Edge commit acknowledgement", async () => {
    const system = createSystem();
    const commands: CloudCommandRequest[] = [
      { commandId: "command-mode", edgeId, equipmentId: "outlet-1", type: "equipment.set-control-mode", payload: { mode: "auto" } },
      { commandId: "command-config", edgeId, equipmentId: "outlet-1", type: "equipment.update-configuration", payload: { name: "Alkalinity Doser", role: "doser" } },
      { commandId: "command-display", edgeId, equipmentId: "outlet-1", type: "equipment.update-display", payload: { displayOrder: 2, hiddenFromDashboard: false } },
      { commandId: "command-program", edgeId, equipmentId: "outlet-1", type: "equipment.set-program-type", payload: { programType: "dosing-pump" } },
      { commandId: "command-schedule", edgeId, equipmentId: "outlet-1", type: "equipment.set-schedule", payload: { schedule: { enabled: false, events: [] } } },
      { commandId: "command-interval", edgeId, equipmentId: "outlet-1", type: "equipment.set-interval-program", payload: { intervalProgram: { enabled: false, startTime: "08:00", durationSeconds: 60, doseMilliliters: 5, intervalSeconds: 3600, weekdays: [1], fallbackState: "off", maximumDailyRuntimeSeconds: 600, maximumDailyDoseMilliliters: 50 } } },
      { commandId: "command-advanced", edgeId, equipmentId: "outlet-1", type: "equipment.set-advanced-program", payload: { advancedOutletProgram: { schema: "modreef.advanced-outlet-program", version: 1, id: "advanced-1", revision: 1, name: "Advanced", enabled: true, defaultState: "off", fallbackState: "off", rules: [], safety: { missingInputState: "off", deferOnSeconds: 0, deferOffSeconds: 0, minimumOnSeconds: 0, minimumOffSeconds: 0 }, updatedAt: "2026-08-03T12:00:00.000Z" } } },
      { commandId: "command-calibration", edgeId, equipmentId: "outlet-1", type: "equipment.set-doser-calibration", payload: { calibration: { millilitersPerMinute: 5, calibratedAt: "2026-07-29T00:00:00Z", recalibrationMonths: 6, dueAt: "2027-01-29T00:00:00Z" } } },
      { commandId: "command-cal-run", edgeId, equipmentId: "outlet-1", type: "equipment.run-doser-calibration", payload: { runtimeSeconds: 300 } },
    ];
    for (const command of commands) await queueCommand(system.cloud, command);

    const edge = new EdgeCloudSync(system.config, system.transport, system.dependencies);
    await edge.runOnce();
    await edge.runOnce();

    expect(system.handlers.controlMode).toHaveBeenCalledWith("outlet-1", "auto");
    expect(system.handlers.configuration).toHaveBeenCalledWith("outlet-1", "Alkalinity Doser", "doser");
    expect(system.handlers.display).toHaveBeenCalledWith("outlet-1", 2, false);
    expect(system.handlers.programType).toHaveBeenCalledWith("outlet-1", "dosing-pump");
    expect(system.handlers.schedule).toHaveBeenCalledOnce();
    expect(system.handlers.intervalProgram).toHaveBeenCalledOnce();
    expect(system.handlers.advancedProgram).toHaveBeenCalledOnce();
    expect(system.handlers.calibration).toHaveBeenCalledOnce();
    expect(system.handlers.calibrationRun).toHaveBeenCalledWith("outlet-1", 300);
    expect([...system.repository.commands.values()].map((command) => command.status))
      .toEqual(commands.map(() => "completed"));
  });
});
