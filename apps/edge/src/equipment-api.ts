import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import {
  isRunDoserCalibrationRequest,
  isSetEquipmentPowerRequest,
  isSetEquipmentSpeedRequest,
  type EquipmentCommandResponse,
} from "@modreef/api-contract";
import type {
  EquipmentControlMode,
  EquipmentDisplaySetting,
  DoserCalibration,
  DosingParameter,
  Equipment,
  EquipmentIntervalProgram,
  EquipmentProgramType,
  EquipmentRole,
  EquipmentSchedule,
  EquipmentSpeedSchedule,
  PhysicalDevice,
  WavemakerModeSettings,
} from "@modreef/digital-twin";
import { isAdvancedOutletProgram } from "@modreef/digital-twin";

import { isOnboardingAuthorized } from "./onboarding-api.js";
import {
  CommandIdConflictError,
  CommandRegistry,
} from "./command-registry.js";
import {
  getEquipmentChannelStates,
  getCachedEquipmentChannelStates,
  getTwin,
  initializeEquipment,
  setEquipmentPower,
  setEquipmentSpeed,
  startEquipmentDose,
  updateDoserCalibration,
  updateAdvancedOutletProgram,
  cloneEquipmentConfiguration,
  updateEquipmentConfiguration,
  updateEquipmentDisplay,
  updateEquipmentLayout,
  updateEquipmentControlMode,
  updateEquipmentIntervalProgram,
  updateEquipmentProgramType,
  updateEquipmentSchedule,
  updateEquipmentSpeedSchedule,
  updateWavemakerConfiguration,
  updateWaterProbeCalibration,
  swapEquipmentBindings,
  type EquipmentChannelTelemetry,
} from "./equipment-runtime.js";
import { isWaterProbeCalibration } from "@modreef/driver-yinmik-water";

const commandRegistry = new CommandRegistry();

export async function executeEquipmentPowerCommand(
  commandId: string,
  equipmentId: string,
  on: boolean,
): Promise<EquipmentCommandResponse> {
  const execution = await commandRegistry.execute(
    commandId,
    `equipment-power:${equipmentId}:${on}`,
    async () => {
      const result = await setEquipmentPower(equipmentId, on);
      return {
        equipment: publicEquipmentItem(result.equipment),
        operationalState: result.operationalState,
        message: result.message,
      };
    },
  );
  return {
    commandId,
    status: "completed",
    replayed: execution.replayed,
    ...execution.result,
  };
}

export async function executeEquipmentSpeedCommand(
  commandId: string,
  equipmentId: string,
  percent: number,
): Promise<EquipmentCommandResponse> {
  const execution = await commandRegistry.execute(
    commandId,
    `equipment-speed:${equipmentId}:${percent}`,
    async () => {
      const result = await setEquipmentSpeed(equipmentId, percent);
      return {
        equipment: publicEquipmentItem(result.equipment),
        operationalState: result.operationalState,
        message: result.message,
      };
    },
  );
  return { commandId, status: "completed", replayed: execution.replayed, ...execution.result };
}

function writeCommandConflict(
  response: ServerResponse,
  error: CommandIdConflictError,
): void {
  response.writeHead(409);
  response.end(
    JSON.stringify({
      error: error.message,
      code: "command_id_conflict",
    }),
  );
}

export function publicEquipmentItem(
  equipment: Equipment,
  devices: PhysicalDevice[] = getTwin().devices ?? [],
  channelState?: EquipmentChannelTelemetry,
): Equipment {
  const { binding, ...publicItem } = equipment;
  const physicalDeviceName = binding
    ? devices.find((device) => device.id === binding.deviceId)?.name
    : undefined;
  const estimatedMdpWatts = binding?.driverId.startsWith("modreef.jebao-mdp:")
    ? estimateMdpPowerWatts(
      channelState?.speedPercent ?? equipment.speedPercent,
      equipment.enabled && equipment.connectionStatus === "online",
    )
    : undefined;

  return {
    ...publicItem,
    ...(binding?.channelId
      ? { physicalConnectionId: binding.channelId }
      : {}),
    ...(physicalDeviceName ? { physicalDeviceName } : {}),
    ...(binding?.deviceId ? { physicalDeviceId: binding.deviceId } : {}),
    ...(binding?.capability ? { physicalCapability: binding.capability } : {}),
    ...(typeof channelState?.watts === "number"
      ? { powerWatts: channelState.watts }
      : typeof estimatedMdpWatts === "number"
        ? { powerWatts: estimatedMdpWatts }
        : {}),
    ...(typeof channelState?.energyKwh === "number"
      ? { energyKwh: channelState.energyKwh }
      : {}),
  };
}

export function estimateMdpPowerWatts(
  speedPercent: number | undefined,
  enabled = true,
): number | undefined {
  if (!enabled) return 0;
  if (typeof speedPercent !== "number" || !Number.isFinite(speedPercent)) {
    return undefined;
  }
  const speed = Math.max(30, Math.min(100, speedPercent));
  return Math.max(0, Math.round(speed * 0.68 - 3));
}

export async function getPublicEquipment() {
  const twin = getTwin();
  const channelStates = await getEquipmentChannelStates();
  return twin.equipment.map((equipment, index) =>
    publicEquipmentItem(
      {
        ...equipment,
        displayOrder: equipment.displayOrder ?? index,
      },
      twin.devices ?? [],
      channelStates[equipment.id],
    ),
  );
}

export function getPublicEquipmentSnapshot() {
  const twin = getTwin();
  const channelStates = getCachedEquipmentChannelStates();
  return twin.equipment.map((equipment, index) =>
    publicEquipmentItem(
      {
        ...equipment,
        displayOrder: equipment.displayOrder ?? index,
      },
      twin.devices ?? [],
      channelStates[equipment.id],
    ),
  );
}

const equipmentRoles: EquipmentRole[] = [
  "return-pump",
  "circulation-pump",
  "light",
  "heater",
  "skimmer",
  "doser",
  "sensor",
  "outlet",
  "uv",
  "ato",
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

function isEquipmentControlMode(
  value: unknown,
): value is EquipmentControlMode {
  return value === "off" || value === "auto" || value === "on";
}

function isEquipmentProgramType(
  value: unknown,
): value is EquipmentProgramType {
  return (
    value === "always-on" ||
    value === "schedule" ||
    value === "light-schedule" ||
    value === "heater" ||
    value === "return-pump" ||
    value === "skimmer" ||
    value === "dosing-pump" ||
    value === "advanced"
  );
}

export function isEquipmentSchedule(
  value: unknown,
): value is EquipmentSchedule {
  if (
    typeof value !== "object" ||
    value === null ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean" ||
    !("events" in value) ||
    !Array.isArray(value.events)
  ) {
    return false;
  }

  return value.events.every(
    (event) =>
      typeof event === "object" &&
      event !== null &&
      "id" in event &&
      typeof event.id === "string" &&
      event.id.trim() !== "" &&
      "weekdays" in event &&
      Array.isArray(event.weekdays) &&
      event.weekdays.length > 0 &&
      event.weekdays.every(
        (weekday: unknown) =>
          typeof weekday === "number" &&
          Number.isInteger(weekday) &&
          weekday >= 0 &&
          weekday <= 6,
      ) &&
      "time" in event &&
      typeof event.time === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time) &&
      "desiredEnabled" in event &&
      typeof event.desiredEnabled === "boolean",
  );
}

export function isEquipmentSpeedSchedule(value: unknown): value is EquipmentSpeedSchedule {
  if (typeof value !== "object" || value === null) return false;
  const schedule = value as Record<string, unknown>;
  return typeof schedule.enabled === "boolean" && Array.isArray(schedule.events) &&
    schedule.events.length <= 24 && schedule.events.every((value) => {
      if (typeof value !== "object" || value === null) return false;
      const event = value as Record<string, unknown>;
      return typeof event.id === "string" && event.id.length > 0 &&
        Array.isArray(event.weekdays) && event.weekdays.length > 0 &&
        event.weekdays.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6) &&
        typeof event.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time) &&
        Number.isInteger(event.speedPercent) && Number(event.speedPercent) >= 10 && Number(event.speedPercent) <= 100;
    });
}

export function isEquipmentIntervalProgram(
  value: unknown,
): value is EquipmentIntervalProgram {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const program = value as Record<string, unknown>;
  const optionalPositiveNumber = (candidate: unknown) =>
    candidate === undefined ||
    (typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate > 0);

  return (
    typeof program.enabled === "boolean" &&
    typeof program.startTime === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(program.startTime) &&
    typeof program.durationSeconds === "number" &&
    Number.isInteger(program.durationSeconds) &&
    program.durationSeconds >= 1 &&
    optionalPositiveNumber(program.doseMilliliters) &&
    typeof program.intervalSeconds === "number" &&
    Number.isInteger(program.intervalSeconds) &&
    program.intervalSeconds > program.durationSeconds &&
    Array.isArray(program.weekdays) &&
    program.weekdays.length > 0 &&
    program.weekdays.every(
      (day) =>
        typeof day === "number" &&
        Number.isInteger(day) &&
        day >= 0 &&
        day <= 6,
    ) &&
    program.fallbackState === "off" &&
    typeof program.maximumDailyRuntimeSeconds === "number" &&
    Number.isInteger(program.maximumDailyRuntimeSeconds) &&
    program.maximumDailyRuntimeSeconds >= program.durationSeconds &&
    optionalPositiveNumber(program.maximumDailyDoseMilliliters)
  );
}

export function isDoserCalibration(
  value: unknown,
): value is DoserCalibration {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const calibration = value as Record<string, unknown>;

  return (
    typeof calibration.millilitersPerMinute === "number" &&
    Number.isFinite(calibration.millilitersPerMinute) &&
    calibration.millilitersPerMinute > 0 &&
    typeof calibration.calibratedAt === "string" &&
    !Number.isNaN(Date.parse(calibration.calibratedAt)) &&
    (calibration.recalibrationMonths === 6 ||
      calibration.recalibrationMonths === 12) &&
    typeof calibration.dueAt === "string" &&
    !Number.isNaN(Date.parse(calibration.dueAt))
  );
}

async function readJson(
  request: IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function handleEquipmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (!request.url?.startsWith("/equipment")) {
    return false;
  }

  if (!isOnboardingAuthorized(request)) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  if (request.method === "GET" && request.url === "/equipment") {
    void getEquipmentChannelStates().catch((error) => {
      console.warn(
        "Could not refresh equipment telemetry:",
        error instanceof Error ? error.message : error,
      );
    });

    response.writeHead(200);
    response.end(
      JSON.stringify({
        equipment: getPublicEquipmentSnapshot(),
      }),
    );
    return true;
  }

  const cloneMatch = /^\/equipment\/([^/]+)\/clone$/.exec(request.url ?? "");
  if (request.method === "POST" && cloneMatch?.[1]) {
    const body = await readJson(request);
    if (
      typeof body !== "object" || body === null ||
      !("destinationEquipmentId" in body) ||
      typeof body.destinationEquipmentId !== "string" ||
      !("name" in body) || typeof body.name !== "string" ||
      !body.name.trim()
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Destination equipment and a new name are required" }));
      return true;
    }
    try {
      const updated = cloneEquipmentConfiguration(
        cloneMatch[1], body.destinationEquipmentId, body.name.trim(),
      );
      const equipment = updated.equipment.find(
        (item) => item.id === body.destinationEquipmentId,
      )!;
      response.writeHead(200);
      response.end(JSON.stringify({ equipment: publicEquipmentItem(equipment) }));
    } catch (error) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Clone failed" }));
    }
    return true;
  }

  const swapMatch = /^\/equipment\/([^/]+)\/swap-binding$/.exec(request.url ?? "");
  if (request.method === "POST" && swapMatch?.[1]) {
    const body = await readJson(request);
    if (
      typeof body !== "object" || body === null ||
      !("otherEquipmentId" in body) || typeof body.otherEquipmentId !== "string"
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Another equipment outlet is required" }));
      return true;
    }
    try {
      const updated = await swapEquipmentBindings(swapMatch[1], body.otherEquipmentId);
      const equipment = [swapMatch[1], body.otherEquipmentId].map((id) =>
        publicEquipmentItem(updated.equipment.find((item) => item.id === id)!),
      );
      response.writeHead(200);
      response.end(JSON.stringify({ equipment }));
    } catch (error) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Swap failed" }));
    }
    return true;
  }

  const displayMatch = /^\/equipment\/([^/]+)\/display$/.exec(request.url ?? "");
  if (request.method === "PUT" && displayMatch?.[1]) {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null ||
        !("displayOrder" in body) || !Number.isSafeInteger(body.displayOrder) ||
        Number(body.displayOrder) < 0 || !("hiddenFromDashboard" in body) ||
        typeof body.hiddenFromDashboard !== "boolean") {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid equipment display settings" }));
      return true;
    }
    const updated = updateEquipmentDisplay(
      displayMatch[1], Number(body.displayOrder), body.hiddenFromDashboard,
    );
    const equipment = updated.equipment.find((item) => item.id === displayMatch[1])!;
    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicEquipmentItem(equipment) }));
    return true;
  }

  if (request.method === "PUT" && request.url === "/equipment-layout") {
    const body = await readJson(request);
    const settings = typeof body === "object" && body !== null &&
      "settings" in body && Array.isArray(body.settings) ? body.settings : undefined;
    if (!settings || !settings.every(isEquipmentDisplaySetting)) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid equipment layout" }));
      return true;
    }
    try {
      const updated = updateEquipmentLayout(settings);
      response.writeHead(200);
      response.end(JSON.stringify({ equipment: updated.equipment.map((item) => publicEquipmentItem(item)) }));
    } catch (error) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Layout update failed" }));
    }
    return true;
  }

  const configurationMatch = /^\/equipment\/([^/]+)$/.exec(
    request.url ?? "",
  );

  if (request.method === "DELETE" && configurationMatch?.[1]) {
    const equipment = getTwin().equipment.find(
      ({ id }) => id === configurationMatch[1],
    );
    if (!equipment) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Equipment not found" }));
      return true;
    }
    response.writeHead(409);
    response.end(JSON.stringify({
      error:
        "Equipment channels belong to their physical device. Hide this channel or remove the physical device.",
      code: "EQUIPMENT_OWNED_BY_DEVICE",
      deviceId: equipment.physicalDeviceId ?? equipment.binding?.deviceId,
    }));
    return true;
  }

  const waterCalibrationMatch = /^\/equipment\/([^/]+)\/water-calibration$/.exec(
    request.url ?? "",
  );
  if (request.method === "PUT" && waterCalibrationMatch?.[1]) {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null ||
      !("calibration" in body) || !isWaterProbeCalibration(body.calibration)) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid water probe calibration" }));
      return true;
    }
    const updated = updateWaterProbeCalibration(
      waterCalibrationMatch[1],
      body.calibration,
    );
    const equipment = updated.equipment.find((item) => item.id === waterCalibrationMatch[1])!;
    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicEquipmentItem(equipment) }));
    return true;
  }

  if (request.method === "PUT" && configurationMatch?.[1]) {
    const body = await readJson(request);

    if (
      typeof body !== "object" ||
      body === null ||
      !("name" in body) ||
      typeof body.name !== "string" ||
      body.name.trim() === "" ||
      !("role" in body) ||
      !isEquipmentRole(body.role)
      || ("automaticRestartDelaySeconds" in body &&
        (!Number.isSafeInteger(body.automaticRestartDelaySeconds) ||
          Number(body.automaticRestartDelaySeconds) < 0 ||
          Number(body.automaticRestartDelaySeconds) > 1_800))
      || ("dosingParameter" in body &&
        !isDosingParameter(body.dosingParameter))
      || ("dosingParameterName" in body &&
        (typeof body.dosingParameterName !== "string" ||
          body.dosingParameterName.trim().length < 1 ||
          body.dosingParameterName.trim().length > 48))
      || ("dosingParameter" in body && body.dosingParameter === "other" &&
        (!("dosingParameterName" in body) ||
          typeof body.dosingParameterName !== "string" ||
          body.dosingParameterName.trim().length < 1))
    ) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Body must contain a valid name and equipment role",
        }),
      );
      return true;
    }

    let updated;
    try {
      updated = updateEquipmentConfiguration(
        configurationMatch[1], body.name.trim(), body.role,
        "automaticRestartDelaySeconds" in body
          ? Number(body.automaticRestartDelaySeconds) : undefined,
        "dosingParameter" in body ? body.dosingParameter as DosingParameter : undefined,
        "dosingParameterName" in body && typeof body.dosingParameterName === "string"
          ? body.dosingParameterName.trim() : undefined,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Equipment update failed";
      response.writeHead(message.startsWith("Equipment not found:") ? 404 : 409);
      response.end(JSON.stringify({ error: message }));
      return true;
    }

    const equipment = updated.equipment.find(
      (item) => item.id === configurationMatch[1],
    );

    if (!equipment) {
      throw new Error(
        `Equipment not found: ${configurationMatch[1]}`,
      );
    }

    const publicItem = publicEquipmentItem(equipment);

    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicItem }));
    return true;
  }

  const intervalProgramMatch =
    /^\/equipment\/([^/]+)\/interval-program$/.exec(
      request.url ?? "",
    );

  if (request.method === "PUT" && intervalProgramMatch?.[1]) {
    const body = await readJson(request);

    if (!isEquipmentIntervalProgram(body)) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Body must contain a valid interval program",
        }),
      );
      return true;
    }

    const updated = await updateEquipmentIntervalProgram(
      intervalProgramMatch[1],
      body,
    );
    const equipment = updated.equipment.find(
      (item) => item.id === intervalProgramMatch[1],
    );

    if (!equipment) {
      throw new Error(
        `Equipment not found: ${intervalProgramMatch[1]}`,
      );
    }

    const publicItem = publicEquipmentItem(equipment);
    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicItem }));
    return true;
  }

  const advancedProgramMatch =
    /^\/equipment\/([^/]+)\/advanced-program$/.exec(request.url ?? "");

  if (request.method === "PUT" && advancedProgramMatch?.[1]) {
    const body = await readJson(request);
    if (!isAdvancedOutletProgram(body)) {
      response.writeHead(400);
      response.end(JSON.stringify({
        error: "Body must contain a valid versioned advanced outlet program",
      }));
      return true;
    }
    const updated = updateAdvancedOutletProgram(advancedProgramMatch[1], body);
    const equipment = updated.equipment.find((item) => item.id === advancedProgramMatch[1]);
    if (!equipment) throw new Error(`Equipment not found: ${advancedProgramMatch[1]}`);
    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicEquipmentItem(equipment) }));
    return true;
  }

  const speedScheduleMatch = /^\/equipment\/([^/]+)\/speed-schedule$/.exec(request.url ?? "");
  if (request.method === "PUT" && speedScheduleMatch?.[1]) {
    const body = await readJson(request);
    if (!isEquipmentSpeedSchedule(body)) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Body must contain a valid pump speed schedule" }));
      return true;
    }
    const updated = updateEquipmentSpeedSchedule(speedScheduleMatch[1], body);
    const equipment = updated.equipment.find(({ id }) => id === speedScheduleMatch[1]);
    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicEquipmentItem(equipment!) }));
    return true;
  }

  const wavemakerMatch = /^\/equipment\/([^/]+)\/wavemaker$/.exec(request.url ?? "");
  if (request.method === "PUT" && wavemakerMatch?.[1]) {
    const body = await readJson(request);
    if (typeof body !== "object" || body === null ||
      !("feedCycleParticipation" in body) || typeof body.feedCycleParticipation !== "boolean" ||
      !("linkRole" in body) || !["independent", "master", "slave"].includes(String(body.linkRole))) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid wavemaker configuration" }));
      return true;
    }
    try {
      const updated = await updateWavemakerConfiguration(
        wavemakerMatch[1], body.feedCycleParticipation,
        body.linkRole as "independent" | "master" | "slave",
        "mode" in body && ["M1", "M2", "M3", "M4", "M5"].includes(String(body.mode))
          ? body.mode as "M1" | "M2" | "M3" | "M4" | "M5"
          : "M3",
        "modeSettings" in body && typeof body.modeSettings === "object"
          ? body.modeSettings as WavemakerModeSettings
          : undefined,
      );
      const equipment = updated.equipment.find(({ id }) => id === wavemakerMatch[1]);
      response.writeHead(200);
      response.end(JSON.stringify({ equipment: publicEquipmentItem(equipment!) }));
    } catch (error) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid wavemaker configuration" }));
    }
    return true;
  }

  const calibrationRunMatch =
    /^\/equipment\/([^/]+)\/doser-calibration-run$/.exec(
      request.url ?? "",
    );

  if (request.method === "POST" && calibrationRunMatch?.[1]) {
    const body = await readJson(request);

    if (!isRunDoserCalibrationRequest(body)) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error:
            "Body must contain a commandId and runtimeSeconds of 60, 300, or 600",
        }),
      );
      return true;
    }

    try {
      const execution = await commandRegistry.execute(
        body.commandId,
        `doser-calibration:${calibrationRunMatch[1]}:${body.runtimeSeconds}`,
        async () => {
          await updateEquipmentControlMode(
            calibrationRunMatch[1]!,
            "off",
          );
          const result = await startEquipmentDose(
            calibrationRunMatch[1]!,
            body.runtimeSeconds,
          );
          return {
            equipment: publicEquipmentItem(result.equipment),
            operationalState: result.operationalState,
            message: result.message,
          };
        },
      );
      const commandResponse: EquipmentCommandResponse = {
        commandId: body.commandId,
        status: "accepted",
        replayed: execution.replayed,
        ...execution.result,
      };

      response.writeHead(200);
      response.end(JSON.stringify(commandResponse));
    } catch (error) {
      if (error instanceof CommandIdConflictError) {
        writeCommandConflict(response, error);
        return true;
      }

      throw error;
    }
    return true;
  }

  const calibrationMatch =
    /^\/equipment\/([^/]+)\/doser-calibration$/.exec(
      request.url ?? "",
    );

  if (request.method === "PUT" && calibrationMatch?.[1]) {
    const body = await readJson(request);

    if (!isDoserCalibration(body)) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Body must contain a valid doser calibration" }));
      return true;
    }

    const updated = updateDoserCalibration(
      calibrationMatch[1],
      body,
    );
    const equipment = updated.equipment.find(
      (item) => item.id === calibrationMatch[1],
    );

    if (!equipment) {
      throw new Error(`Equipment not found: ${calibrationMatch[1]}`);
    }

    const publicItem = publicEquipmentItem(equipment);
    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicItem }));
    return true;
  }

  const scheduleMatch =
    /^\/equipment\/([^/]+)\/schedule$/.exec(
      request.url ?? "",
    );

  if (request.method === "PUT" && scheduleMatch?.[1]) {
    const body = await readJson(request);

    if (!isEquipmentSchedule(body)) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Body must contain a valid equipment schedule",
        }),
      );
      return true;
    }

    const updated = updateEquipmentSchedule(
      scheduleMatch[1],
      body,
    );

    const equipment = updated.equipment.find(
      (item) => item.id === scheduleMatch[1],
    );

    if (!equipment) {
      throw new Error(
        `Equipment not found: ${scheduleMatch[1]}`,
      );
    }

    const publicItem = publicEquipmentItem(equipment);

    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicItem }));
    return true;
  }

  const programTypeMatch =
    /^\/equipment\/([^/]+)\/program-type$/.exec(
      request.url ?? "",
    );

  if (
    request.method === "PUT" &&
    programTypeMatch?.[1]
  ) {
    const body = await readJson(request);

    if (
      typeof body !== "object" ||
      body === null ||
      !("programType" in body) ||
      !isEquipmentProgramType(body.programType)
    ) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error:
            "Body must contain a valid equipment program type",
        }),
      );
      return true;
    }

    const updated = updateEquipmentProgramType(
      programTypeMatch[1],
      body.programType,
    );

    const equipment = updated.equipment.find(
      (item) => item.id === programTypeMatch[1],
    );

    if (!equipment) {
      throw new Error(
        `Equipment not found: ${programTypeMatch[1]}`,
      );
    }

    const publicItem = publicEquipmentItem(equipment);

    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicItem }));
    return true;
  }

  const controlModeMatch =
    /^\/equipment\/([^/]+)\/control-mode$/.exec(
      request.url ?? "",
    );

  if (
    request.method === "PUT" &&
    controlModeMatch?.[1]
  ) {
    const body = await readJson(request);

    if (
      typeof body !== "object" ||
      body === null ||
      !("mode" in body) ||
      !isEquipmentControlMode(body.mode)
    ) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: 'Body must contain mode "off", "auto", or "on"',
        }),
      );
      return true;
    }

    const updated = await updateEquipmentControlMode(
      controlModeMatch[1],
      body.mode,
    );

    const equipment = updated.equipment.find(
      (item) => item.id === controlModeMatch[1],
    );

    if (!equipment) {
      throw new Error(
        `Equipment not found: ${controlModeMatch[1]}`,
      );
    }

    const publicItem = publicEquipmentItem(equipment);

    response.writeHead(200);
    response.end(JSON.stringify({ equipment: publicItem }));
    return true;
  }

  const match = /^\/equipment\/([^/]+)\/power$/.exec(
    request.url ?? "",
  );

  if (request.method === "POST" && match?.[1]) {
    const body = await readJson(request);

    if (!isSetEquipmentPowerRequest(body)) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Body must contain a commandId and boolean on value",
        }),
      );
      return true;
    }

    try {
      const commandResponse = await executeEquipmentPowerCommand(
        body.commandId,
        match[1],
        body.on,
      );

      response.writeHead(200);
      response.end(JSON.stringify(commandResponse));
    } catch (error) {
      if (error instanceof CommandIdConflictError) {
        writeCommandConflict(response, error);
        return true;
      }

      throw error;
    }
    return true;
  }

  const speedMatch = /^\/equipment\/([^/]+)\/speed$/.exec(request.url ?? "");
  if (request.method === "POST" && speedMatch?.[1]) {
    const body = await readJson(request);
    if (!isSetEquipmentSpeedRequest(body)) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Body must contain a commandId and integer percent" }));
      return true;
    }
    try {
      response.writeHead(200);
      response.end(JSON.stringify(await executeEquipmentSpeedCommand(body.commandId, speedMatch[1], body.percent)));
    } catch (error) {
      if (error instanceof CommandIdConflictError) {
        writeCommandConflict(response, error);
        return true;
      }
      throw error;
    }
    return true;
  }

  return false;
}
