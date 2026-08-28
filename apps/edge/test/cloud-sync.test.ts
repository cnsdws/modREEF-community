import { describe, expect, it, vi } from "vitest";
import type { AquariumEvent } from "@modreef/digital-twin";
import type { EdgeSyncRequest, EdgeSyncResponse } from "@modreef/api-contract";
import {
  EdgeCloudSync, waterAlarmSettingsStateKey,
  type EdgeCloudDependencies, type EdgeCloudTransport,
} from "../src/cloud-sync.js";
import { defaultWaterAlarmRules } from "@modreef/api-contract";

const event: AquariumEvent = {
  id: "event-1", aquariumId: "reef", type: "observation", observation: "Clear water",
  occurredAt: "2026-07-26T12:00:00Z", recordedAt: "2026-07-26T12:00:01Z", source: "manual",
};

function dependencies(
  executeControlMode = vi.fn(async () => undefined),
  executeConfiguration = vi.fn(async () => undefined),
  executeCreateEvent = vi.fn(async () => event),
  executeUpdateEvent = vi.fn(async () => event),
  executeDeleteEvent = vi.fn(async () => undefined),
) {
  const state = new Map<string, unknown>();
  const executeProgramType = vi.fn(async () => undefined);
  const executeAdvancedProgram = vi.fn(async () => undefined);
  const executeStartFeedMode = vi.fn(async () => undefined);
  const executeStopFeedMode = vi.fn(async () => undefined);
  const executeControllerUpdateCheck = vi.fn(async () => undefined);
  const executeControllerReleaseChannel = vi.fn(async () => undefined);
  const value: EdgeCloudDependencies = {
    loadState: (key) => state.get(key) as never,
    saveState: (key, item) => state.set(key, structuredClone(item)),
    listEventsAfter: (_aquariumId, cursor) => cursor ? [] : [event],
    getAquariumId: () => "reef",
    getEquipment: async () => [],
    executeControlMode,
    executeConfiguration,
    executeProgramType,
    executeAdvancedProgram,
    executeCreateEvent,
    executeUpdateEvent,
    executeDeleteEvent,
    executeStartFeedMode,
    executeStopFeedMode,
    executeControllerUpdateCheck,
    executeControllerReleaseChannel,
    uptimeSeconds: () => 42,
  };
  return { value, state, executeConfiguration, executeControlMode, executeCreateEvent, executeProgramType, executeAdvancedProgram, executeStartFeedMode, executeStopFeedMode, executeControllerUpdateCheck, executeControllerReleaseChannel };
}

const config = { cloudUrl: "https://api.modreef.test", edgeId: "edge-1", aquariumId: "aquarium-1", token: "secret" };

describe("Edge cloud synchronization", () => {
  it("reports physical devices independently from their equipment channels", async () => {
    const deps = dependencies();
    deps.value.getDevices = () => [{
      id: "sensor-1", aquariumId: "reef", name: "Water Monitor",
      manufacturer: "YINMIK", model: "Water 7-in-1", driverId: "yinmik:sensor-1",
      connectionStatus: "online", createdAt: "2026-08-11T12:00:00Z",
    }];
    let request: EdgeSyncRequest | undefined;
    const transport: EdgeCloudTransport = { exchange: async (value) => {
      request = value;
      return { acceptedThroughSequence: 1, acceptedCommandIds: [], commands: [], serverTime: "now" };
    } };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(request?.devices).toEqual([expect.objectContaining({
      deviceId: "sensor-1", edgeId: "edge-1",
      document: expect.objectContaining({ name: "Water Monitor" }),
    })]);
  });

  it("caches shared water alarm settings for offline operation", async () => {
    const deps = dependencies();
    const settings = {
      aquariumId: "aquarium-1", revision: 3,
      updatedAt: "2026-08-10T12:00:00Z", rules: defaultWaterAlarmRules,
    };
    const transport: EdgeCloudTransport = { exchange: async () => ({
      acceptedThroughSequence: 0, acceptedCommandIds: [], commands: [],
      serverTime: "2026-08-10T12:00:00Z", waterAlarmSettings: settings,
    }) };
    await new EdgeCloudSync(config, transport, deps.value).runOnce();
    expect(deps.state.get(waterAlarmSettingsStateKey)).toEqual(settings);
  });

  it("persists and replays the identical event batch after an offline failure", async () => {
    const deps = dependencies();
    const requests: EdgeSyncRequest[] = [];
    const offline: EdgeCloudTransport = { exchange: async (request) => { requests.push(request); throw new Error("offline"); } };
    await new EdgeCloudSync(config, offline, deps.value).runOnce();

    const online: EdgeCloudTransport = { exchange: async (request) => {
      requests.push(request);
      return { acceptedThroughSequence: 1, acceptedCommandIds: [], commands: [], serverTime: "2026-07-26T12:01:00Z" };
    } };
    await new EdgeCloudSync(config, online, deps.value).runOnce();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.events).toEqual(requests[0]!.events);
    expect(requests[1]!.events[0]?.sequence).toBe(1);
  });

  it("executes a power command and reports its durable result on the next exchange", async () => {
    const deps = dependencies();
    const requests: EdgeSyncRequest[] = [];
    let exchange = 0;
    const transport: EdgeCloudTransport = { exchange: async (request): Promise<EdgeSyncResponse> => {
      requests.push(request);
      exchange += 1;
      return exchange === 1 ? {
        acceptedThroughSequence: 1, acceptedCommandIds: [], serverTime: "2026-07-26T12:01:00Z",
        commands: [{ commandId: "command-1", aquariumId: "aquarium-1", edgeId: "edge-1", equipmentId: "pump", type: "equipment.set-power", payload: { on: false }, status: "delivered", createdAt: "2026-07-26T12:00:00Z" }],
      } : { acceptedThroughSequence: 0, acceptedCommandIds: ["command-1"], commands: [], serverTime: "2026-07-26T12:01:15Z" };
    } };
    const sync = new EdgeCloudSync(config, transport, deps.value);
    await sync.runOnce();
    await sync.runOnce();
    expect(deps.executeControlMode).toHaveBeenCalledOnce();
    expect(requests[1]!.commandResults).toEqual([{ commandId: "command-1", status: "completed" }]);
  });

  it("reports a completed command immediately after command execution", async () => {
    const deps = dependencies();
    const requests: EdgeSyncRequest[] = [];
    const transport: EdgeCloudTransport = { exchange: async (request): Promise<EdgeSyncResponse> => {
      requests.push(request);
      return requests.length === 1 ? {
        acceptedThroughSequence: 1,
        acceptedCommandIds: [],
        serverTime: "2026-07-26T12:01:00Z",
        commands: [{
          commandId: "command-immediate", aquariumId: "aquarium-1", edgeId: "edge-1",
          equipmentId: "pump", type: "equipment.set-power", payload: { on: false },
          status: "delivered", createdAt: "2026-07-26T12:00:00Z",
        }],
      } : {
        acceptedThroughSequence: 0,
        acceptedCommandIds: ["command-immediate"],
        commands: [],
        serverTime: "2026-07-26T12:01:01Z",
      };
    } };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.commandResults).toEqual([
      { commandId: "command-immediate", status: "completed" },
    ]);
  });

  it("starts a Feed Cycle through a confirmed cloud command", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = { exchange: async () => ({
      acceptedThroughSequence: 0,
      acceptedCommandIds: [],
      serverTime: "2026-07-26T12:01:00Z",
      commands: [{
        commandId: "command-feed", aquariumId: "aquarium-1", edgeId: "edge-1",
        equipmentId: "feed-cycle", type: "automation.feed-cycle.start",
        payload: { durationSeconds: 300, skimmerRestartDelaySeconds: 120, cycleId: "A" },
        status: "delivered", createdAt: "2026-07-26T12:00:00Z",
      }],
    }) };
    await new EdgeCloudSync(config, transport, deps.value).runOnce();
    expect(deps.executeStartFeedMode).toHaveBeenCalledWith("command-feed", 300, 120, "A");
  });

  it("requests a qualified controller update through a durable cloud command", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = { exchange: async () => ({
      acceptedThroughSequence: 0,
      acceptedCommandIds: [],
      serverTime: "2026-08-11T12:01:00Z",
      commands: [{
        commandId: "command-update", aquariumId: "aquarium-1", edgeId: "edge-1",
        equipmentId: "edge-1", type: "controller.check-for-update", payload: {},
        status: "delivered", createdAt: "2026-08-11T12:00:00Z",
      }],
    }) };
    await new EdgeCloudSync(config, transport, deps.value).runOnce();
    expect(deps.executeControllerUpdateCheck).toHaveBeenCalledWith("command-update");
  });

  it("persists a controller release channel before requesting its update", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = { exchange: async () => ({
      acceptedThroughSequence: 0,
      acceptedCommandIds: [],
      serverTime: "2026-08-26T12:01:00Z",
      commands: [{
        commandId: "command-channel", aquariumId: "aquarium-1", edgeId: "edge-1",
        equipmentId: "edge-1", type: "controller.set-release-channel",
        payload: { channel: "staging" }, status: "delivered",
        createdAt: "2026-08-26T12:00:00Z",
      }],
    }) };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeControllerReleaseChannel).toHaveBeenCalledWith(
      "command-channel",
      "staging",
    );
  });

  it("passes the requested state to the persistent manual-control operation", async () => {
    const deps = dependencies();
    let exchange = 0;
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: exchange++ === 0 ? [] : ["command-off"],
        serverTime: "2026-07-26T12:01:00Z",
        commands: exchange === 1 ? [{
          commandId: "command-off",
          aquariumId: "aquarium-1",
          edgeId: "edge-1",
          equipmentId: "return-pump",
          type: "equipment.set-power",
          payload: { on: false },
          status: "delivered",
          createdAt: "2026-07-26T12:00:00Z",
        }] : [],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeControlMode).toHaveBeenCalledWith(
      "command-off",
      "return-pump",
      "off",
    );
  });

  it("restores automatic control through a cloud command", async () => {
    const deps = dependencies();
    let exchange = 0;
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: exchange++ === 0 ? [] : ["command-auto"],
        serverTime: "2026-07-26T12:01:00Z",
        commands: exchange === 1 ? [{
          commandId: "command-auto",
          aquariumId: "aquarium-1",
          edgeId: "edge-1",
          equipmentId: "return-pump",
          type: "equipment.set-control-mode",
          payload: { mode: "auto" },
          status: "delivered",
          createdAt: "2026-07-26T12:00:00Z",
        }] : [],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeControlMode).toHaveBeenCalledWith(
      "command-auto",
      "return-pump",
      "auto",
    );
  });

  it("does not execute stale operational commands after reconnecting", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-07-26T12:05:00Z",
        commands: [{
          commandId: "stale-off",
          aquariumId: "aquarium-1",
          edgeId: "edge-1",
          equipmentId: "return-pump",
          type: "equipment.set-control-mode",
          payload: { mode: "off" },
          status: "delivered",
          createdAt: "2026-07-26T12:01:00Z",
        }],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeControlMode).not.toHaveBeenCalled();
    expect(deps.state.get("cloud-sync-v1")).toMatchObject({
      commandResults: [{
        commandId: "stale-off",
        status: "failed",
        message: "Operational command expired before execution",
      }],
    });
  });

  it("updates equipment configuration through a cloud command", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-07-27T12:01:00Z",
        commands: [{
          commandId: "command-rename",
          aquariumId: "aquarium-1",
          edgeId: "edge-1",
          equipmentId: "return-pump",
          type: "equipment.update-configuration",
          payload: {
            name: "Main Return Pump",
            role: "uv",
            automaticRestartDelaySeconds: 300,
            dosingParameter: "alkalinity",
          },
          status: "delivered",
          createdAt: "2026-07-27T12:00:00Z",
        }],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeConfiguration).toHaveBeenCalledWith(
      "command-rename",
      "return-pump",
      "Main Return Pump",
      "uv",
      300,
      "alkalinity",
      undefined,
    );
  });

  it("routes physical-device rename and delete commands to the owning Edge", async () => {
    const deps = dependencies();
    const executeRenameDevice = vi.fn(async () => undefined);
    const executeDeleteDevice = vi.fn(async () => undefined);
    deps.value.executeRenameDevice = executeRenameDevice;
    deps.value.executeDeleteDevice = executeDeleteDevice;
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-07-30T18:00:00Z",
        commands: [
          {
            commandId: "command-device-rename", aquariumId: "aquarium-1",
            edgeId: "edge-1", equipmentId: "strip-1", type: "managed-device.rename",
            payload: { deviceId: "strip-1", name: "Return Equipment" },
            status: "delivered", createdAt: "2026-07-30T17:59:58Z",
          },
          {
            commandId: "command-device-delete", aquariumId: "aquarium-1",
            edgeId: "edge-1", equipmentId: "strip-2", type: "managed-device.delete",
            payload: { deviceId: "strip-2" }, status: "delivered",
            createdAt: "2026-07-30T17:59:59Z",
          },
        ],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(executeRenameDevice).toHaveBeenCalledWith(
      "command-device-rename", "strip-1", "Return Equipment",
    );
    expect(executeDeleteDevice).toHaveBeenCalledWith(
      "command-device-delete", "strip-2",
    );
  });

  it("routes outlet clone and binding swap through the same cloud command path", async () => {
    const deps = dependencies();
    const executeCloneEquipment = vi.fn(async () => undefined);
    const executeSwapEquipment = vi.fn(async () => undefined);
    deps.value.executeCloneEquipment = executeCloneEquipment;
    deps.value.executeSwapEquipment = executeSwapEquipment;
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-08-11T17:00:00Z",
        commands: [{
          commandId: "clone", aquariumId: "aquarium-1", edgeId: "edge-1",
          equipmentId: "outlet-1", type: "equipment.clone-configuration",
          payload: { destinationEquipmentId: "outlet-2", name: "Backup" },
          status: "delivered", createdAt: "2026-08-11T16:59:59Z",
        }, {
          commandId: "swap", aquariumId: "aquarium-1", edgeId: "edge-1",
          equipmentId: "outlet-1", type: "equipment.swap-binding",
          payload: { otherEquipmentId: "outlet-2" },
          status: "delivered", createdAt: "2026-08-11T16:59:59Z",
        }],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(executeCloneEquipment).toHaveBeenCalledWith(
      "clone", "outlet-1", "outlet-2", "Backup",
    );
    expect(executeSwapEquipment).toHaveBeenCalledWith(
      "swap", "outlet-1", "outlet-2",
    );
  });

  it("applies an equipment layout as one atomic command", async () => {
    const deps = dependencies();
    const executeLayout = vi.fn(async () => undefined);
    deps.value.executeLayout = executeLayout;
    const settings = [
      { equipmentId: "outlet-2", displayOrder: 0, hiddenFromDashboard: false },
      { equipmentId: "outlet-1", displayOrder: 1, hiddenFromDashboard: true },
    ];
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-08-12T21:00:00Z",
        commands: [{
          commandId: "layout", aquariumId: "aquarium-1", edgeId: "edge-1",
          equipmentId: "outlet-2", type: "equipment.update-layout",
          payload: { settings }, status: "delivered", createdAt: "2026-08-12T20:59:59Z",
        }],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(executeLayout).toHaveBeenCalledOnce();
    expect(executeLayout).toHaveBeenCalledWith("layout", settings);
  });

  it("updates an equipment AUTO program through a cloud command", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-07-28T22:00:00Z",
        commands: [{
          commandId: "command-program",
          aquariumId: "aquarium-1",
          edgeId: "edge-1",
          equipmentId: "outlet-1",
          type: "equipment.set-program-type",
          payload: { programType: "dosing-pump" },
          status: "delivered",
          createdAt: "2026-07-28T21:59:00Z",
        }],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeProgramType).toHaveBeenCalledWith(
      "command-program",
      "outlet-1",
      "dosing-pump",
    );
  });

  it("delivers a validated advanced outlet program", async () => {
    const deps = dependencies();
    const program = {
      schema: "modreef.advanced-outlet-program", version: 1, id: "advanced-1", revision: 1,
      name: "Advanced", enabled: true, defaultState: "off", fallbackState: "off", rules: [],
      safety: { missingInputState: "off", deferOnSeconds: 0, deferOffSeconds: 0, minimumOnSeconds: 0, minimumOffSeconds: 0 },
      updatedAt: "2026-08-03T12:00:00.000Z",
    };
    const transport: EdgeCloudTransport = { exchange: async () => ({
      acceptedThroughSequence: 0, acceptedCommandIds: [], serverTime: "2026-08-03T12:00:00Z",
      commands: [{
        commandId: "command-advanced", aquariumId: "aquarium-1", edgeId: "edge-1",
        equipmentId: "outlet-1", type: "equipment.set-advanced-program",
        payload: { advancedOutletProgram: program }, status: "delivered", createdAt: "2026-08-03T11:59:00Z",
      }],
    }) };
    await new EdgeCloudSync(config, transport, deps.value).runOnce();
    expect(deps.executeAdvancedProgram).toHaveBeenCalledWith("command-advanced", "outlet-1", program);
  });

  it("routes detailed dosing configuration through durable Edge commands", async () => {
    const deps = dependencies();
    const executeSchedule = vi.fn(async () => undefined);
    const executeIntervalProgram = vi.fn(async () => undefined);
    const executeDoserCalibration = vi.fn(async () => undefined);
    const executeDoserCalibrationRun = vi.fn(async () => undefined);
    deps.value.executeSchedule = executeSchedule;
    deps.value.executeIntervalProgram = executeIntervalProgram;
    deps.value.executeDoserCalibration = executeDoserCalibration;
    deps.value.executeDoserCalibrationRun = executeDoserCalibrationRun;
    const schedule = {
      enabled: true,
      events: [{ id: "dose-on", weekdays: [1], time: "08:00", desiredEnabled: true }],
    };
    const intervalProgram = {
      enabled: true,
      startTime: "08:00",
      durationSeconds: 60,
      doseMilliliters: 5,
      intervalSeconds: 3600,
      weekdays: [1],
      fallbackState: "off" as const,
      maximumDailyRuntimeSeconds: 600,
      maximumDailyDoseMilliliters: 50,
    };
    const calibration = {
      millilitersPerMinute: 5,
      calibratedAt: "2026-07-28T20:00:00Z",
      recalibrationMonths: 6 as const,
      dueAt: "2027-01-28T20:00:00Z",
    };
    const commands = [
      { commandId: "command-schedule", type: "equipment.set-schedule", payload: { schedule } },
      { commandId: "command-interval", type: "equipment.set-interval-program", payload: { intervalProgram } },
      { commandId: "command-calibration", type: "equipment.set-doser-calibration", payload: { calibration } },
      { commandId: "command-calibration-run", type: "equipment.run-doser-calibration", payload: { runtimeSeconds: 600 } },
    ].map((command) => ({
      ...command,
      aquariumId: "aquarium-1",
      edgeId: "edge-1",
      equipmentId: "outlet-1",
      status: "delivered" as const,
      createdAt: "2026-07-28T20:00:00Z",
    }));
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        commands,
        serverTime: "2026-07-28T20:00:01Z",
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(executeSchedule).toHaveBeenCalledWith("command-schedule", "outlet-1", schedule);
    expect(executeIntervalProgram).toHaveBeenCalledWith("command-interval", "outlet-1", intervalProgram);
    expect(executeDoserCalibration).toHaveBeenCalledWith("command-calibration", "outlet-1", calibration);
    expect(executeDoserCalibrationRun).toHaveBeenCalledWith("command-calibration-run", "outlet-1", 600);
  });

  it("records a cloud-created measurement through the Edge event store", async () => {
    const deps = dependencies();
    const transport: EdgeCloudTransport = {
      exchange: async () => ({
        acceptedThroughSequence: 0,
        acceptedCommandIds: [],
        serverTime: "2026-07-27T17:20:00Z",
        commands: [{
          commandId: "command-measurement",
          aquariumId: "aquarium-1",
          edgeId: "edge-1",
          equipmentId: "aquarium",
          type: "aquarium.event.create",
          payload: {
            eventId: "measurement-123",
            event: { type: "measurement", parameter: "potassium", value: 400, unit: "ppm" },
          },
          status: "delivered",
          createdAt: "2026-07-27T17:19:00Z",
        }],
      }),
    };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();

    expect(deps.executeCreateEvent).toHaveBeenCalledWith(
      "command-measurement",
      "measurement-123",
      { type: "measurement", parameter: "potassium", value: 400, unit: "ppm" },
    );
  });

  it("routes water probe calibration to the owning Edge", async () => {
    const deps = dependencies();
    const executeWaterProbeCalibration = vi.fn(async () => undefined);
    deps.value.executeWaterProbeCalibration = executeWaterProbeCalibration;
    const calibration = {
      temperature: { offset: 0.5, calibratedAt: "2026-08-10T12:00:00Z" },
    };
    const transport: EdgeCloudTransport = { exchange: async () => ({
      acceptedThroughSequence: 0,
      acceptedCommandIds: [],
      serverTime: "2026-08-10T12:00:01Z",
      commands: [{
        commandId: "command-water-calibration", aquariumId: "aquarium-1",
        edgeId: "edge-1", equipmentId: "water-sensor",
        type: "equipment.set-water-calibration", payload: { calibration },
        status: "delivered", createdAt: "2026-08-10T12:00:00Z",
      }],
    }) };

    await new EdgeCloudSync(config, transport, deps.value).runOnce();
    expect(executeWaterProbeCalibration).toHaveBeenCalledWith(
      "command-water-calibration", "water-sensor", calibration,
    );
  });
});
