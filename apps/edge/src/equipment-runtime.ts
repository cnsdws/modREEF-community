import { join } from "node:path";

import {
  removePhysicalDevice,
  updatePhysicalDeviceName,
  setDoserCalibration as setTwinDoserCalibration,
  setAdvancedOutletProgram as setTwinAdvancedOutletProgram,
  setEquipmentControlMode as setTwinEquipmentControlMode,
  setEquipmentIntervalProgram as setTwinEquipmentIntervalProgram,
  setEquipmentProgramType as setTwinEquipmentProgramType,
  setEquipmentSchedule as setTwinEquipmentSchedule,
  setEquipmentEnabled as setTwinEquipmentEnabled,
  setEquipmentSpeed as setTwinEquipmentSpeed,
  setEquipmentSpeedSchedule as setTwinEquipmentSpeedSchedule,
  updateEquipmentDetails,
  updateWavemakerConfiguration as updateTwinWavemakerConfiguration,
  type WavemakerLinkRole,
  type WavemakerMode,
  type WavemakerModeSettings,
  type AquariumDigitalTwin,
  type AdvancedOutletProgram,
  type ActivityCategory,
  type EquipmentControlMode,
  type EquipmentDisplaySetting,
  type DoserCalibration,
  type DosingParameter,
  type EquipmentIntervalProgram,
  type EquipmentProgramType,
  type EquipmentRole,
  type EquipmentSchedule,
  type EquipmentSpeedSchedule,
  type WaterProbeCalibration,
} from "@modreef/digital-twin";
import { OnboardingRegistry } from "./onboarding-registry.js";
import {
  GHomeWp12Driver,
  PythonGHomeWp12Transport,
} from "@modreef/driver-ghome-wp12";
import {
  JebaoMd44Driver,
  TcpJebaoMd44Transport,
  translateMd44IntervalProgram,
} from "@modreef/driver-jebao-md44";
import {
  discoverMdpPumps,
  JebaoMdpDriver,
  TcpMdpTransport,
} from "@modreef/driver-jebao-mdp";
import { EquipmentController } from "@modreef/equipment";
import type { DeviceDriver } from "@modreef/hal";
import { SqliteTwinStore } from "@modreef/storage-sqlite";
import { createInitialTwin } from "./initial-twin.js";

import {
  createGHomeWp12Device,
  ensureGHomeWp12Equipment,
} from "./ghome-wp12-equipment.js";
import {
  createActivityEvent,
  type AquariumActivityInput,
} from "./activity-log.js";
import {
  EdgeCredentialStore,
  type GHomeWp12Credentials,
} from "./edge-credential-store.js";
import {
  cloneEquipmentConfigurationInTwin,
  swapEquipmentBindingsInTwin,
} from "./equipment-transfer.js";
import {
  dataDirectory,
  deviceCredentialPath,
  repositoryRoot,
} from "./equipment-runtime-paths.js";
import { GHomeDiscovery } from "./ghome-discovery.js";
import { ghomeCredentialDeviceIdForRuntime } from "./ghome-runtime-identity.js";
import { DmpBleController, verifyDmpBleIdentity } from "./dmp-ble.js";
import {
  commissionMatterDevice,
  MatterOutletDriver,
  removeMatterDevice,
  type MatterCommissioningStage,
} from "./matter-controller.js";
import { addMatterDevice } from "./matter-equipment.js";
import { withTimeout } from "./async-timeout.js";
import { setDeviceConnectivity } from "./equipment-connectivity.js";
import {
  addYinmikWaterDevice,
  appendRawWaterSamples,
  appendWaterMeasurementHistory,
  applyWaterProbeCalibration,
  filteredWaterMeasurements,
  yinmikWaterDriverPrefix,
  yinmikWaterMeasurements,
  waterMeasurementStability,
} from "./yinmik-water-equipment.js";

const legacyDeviceId = "ghome-wp12";
const legacyDriverId = "modreef.ghome.wp12";

export { dataDirectory } from "./equipment-runtime-paths.js";

export const runtimeStore = new SqliteTwinStore(
  join(dataDirectory, "modreef.db"),
);

const credentialStore = new EdgeCredentialStore(
  deviceCredentialPath,
);
const yinmikDiscovery = new GHomeDiscovery(repositoryRoot);

const retentionIntervalMilliseconds = 24 * 60 * 60 * 1000;
// Keep this below both the health startup grace period and the cloud client's
// acknowledgement window. A stalled device may degrade its own commands, but
// it must not prevent schedules or commands for every other device.
const deviceOperationTimeoutMilliseconds = 5_000;
const mdpOperationTimeoutMilliseconds = 15_000;
const matterOperationTimeoutMilliseconds = 15_000;
const mdpRegistrationsKey = "mdp-pump-registrations-v2";
const md44RegistrationsKey = "md44-doser-registrations-v1";
const dmpRegistrationsKey = "dmp-wavemaker-registrations-v1";

export interface MdpPumpRegistration {
  deviceId: string;
  networkAddress: string;
  displayName: string;
  model: "MDP-8500" | "MDP-20000";
}

export interface Md44DoserRegistration {
  deviceId: string;
  networkAddress: string;
  displayName: string;
  gizwitsDeviceId: string;
}

export interface DmpWavemakerRegistration {
  deviceId: string;
  displayName: string;
  advertisedName: string;
  bluetoothAddress: string;
}

function operationTimeout(deviceId: string): number {
  if (deviceId.startsWith("mdp-")) return mdpOperationTimeoutMilliseconds;
  if (deviceId.startsWith("matter-")) return matterOperationTimeoutMilliseconds;
  return deviceOperationTimeoutMilliseconds;
}

export function purgeExpiredAquariumEvents(now = new Date()): number {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 24);
  const removed = runtimeStore.purgeEventsBefore(cutoff);

  console.info(
    `Aquarium event retention: removed ${removed} record(s) before ${cutoff.toISOString()}`,
  );

  return removed;
}

purgeExpiredAquariumEvents();

const retentionTimer = setInterval(
  purgeExpiredAquariumEvents,
  retentionIntervalMilliseconds,
);
retentionTimer.unref();

let twin = runtimeStore.load("reef") ?? createInitialTwin();
const drivers = new Map<string, DeviceDriver>();
const yinmikTransports = new Map<string, PythonGHomeWp12Transport>();
const yinmikCredentials = new Map<string, GHomeWp12Credentials>();
const yinmikLastSampleAt = new Map<string, number>();
const credentialDeviceIds = new Map<string, string>();
const connectedDeviceIds = new Set<string>();
const deviceInitializationPromises = new Map<string, Promise<void>>();
let mdpRegistrations = loadMdpRegistrations();
let md44Registrations = loadMd44Registrations();
let dmpRegistrations = loadDmpRegistrations();
let dmpConnectivityRefresh: Promise<void> | null = null;
let dmpConnectivityRefreshedAt = 0;
const dmpConnectivityRefreshIntervalMilliseconds = 60_000;

function driverIdFor(deviceId: string): string {
  return deviceId === legacyDeviceId
    ? legacyDriverId
    : `${legacyDriverId}:${deviceId}`;
}

function installDriver(
  runtimeDeviceId: string,
  credentials?: GHomeWp12Credentials,
): GHomeWp12Driver {
  const driver = new GHomeWp12Driver(
    runtimeDeviceId,
    new PythonGHomeWp12Transport(
      "scripts/tuya-bridge.py",
      repositoryRoot,
      process.env.MODREEF_PYTHON ?? "python3",
      credentials,
    ),
    driverIdFor(runtimeDeviceId),
  );
  drivers.set(runtimeDeviceId, driver);
  if (credentials) {
    credentialDeviceIds.set(runtimeDeviceId, credentials.deviceId);
  }
  return driver;
}

const allStoredTuyaCredentials = credentialStore.listGHomeWp12();
const storedCredentials = allStoredTuyaCredentials.filter(
  ({ deviceKind }) => deviceKind !== "yinmik-water",
);
if (storedCredentials.length > 0) {
  storedCredentials.forEach((credentials, index) => {
    const runtimeDeviceId = credentials.runtimeDeviceId ?? (
      index === 0 ? legacyDeviceId : credentials.deviceId
    );
    const driver = installDriver(runtimeDeviceId, credentials);
    if (!twin.devices?.some((device) => device.id === runtimeDeviceId)) {
      twin = {
        ...twin,
        devices: [
          ...(twin.devices ?? []),
          createGHomeWp12Device(twin, driver.id, runtimeDeviceId),
        ],
      };
    }
    twin = ensureGHomeWp12Equipment(twin, driver.id, runtimeDeviceId);
  });
}
for (const credentials of allStoredTuyaCredentials.filter(
  ({ deviceKind }) => deviceKind === "yinmik-water",
)) {
  twin = addYinmikWaterDevice(twin, credentials.deviceId);
  credentialDeviceIds.set(credentials.deviceId, credentials.deviceId);
  yinmikCredentials.set(credentials.deviceId, credentials);
  yinmikTransports.set(credentials.deviceId, new PythonGHomeWp12Transport(
    "scripts/tuya-bridge.py",
    repositoryRoot,
    process.env.MODREEF_PYTHON ?? "python3",
    { ...credentials, protocolVersion: credentials.protocolVersion ?? "3.4" },
  ));
}

for (const device of twin.devices ?? []) {
  if (device.driverId.startsWith("modreef.matter:")) {
    drivers.set(device.id, new MatterOutletDriver(device.id));
  }
}

for (const registration of mdpRegistrations) {
  installMdpDriver(registration);
  ensureMdpTwin(registration);
}
for (const registration of md44Registrations) ensureMd44Twin(registration);
for (const registration of md44Registrations) installMd44Driver(registration);
for (const registration of dmpRegistrations) ensureDmpTwin(registration);

runtimeStore.save(twin);

let controller = new EquipmentController([...drivers.values()]);

async function initializeDevice(deviceId: string): Promise<void> {
  try {
    await initializeDeviceAttempt(deviceId);
  } catch (error) {
    const driver = drivers.get(deviceId);
    if (driver) updateDeviceConnectivity(driver.id, deviceId, false);
    throw error;
  }
}

async function initializeDeviceAttempt(deviceId: string): Promise<void> {
  if (connectedDeviceIds.has(deviceId)) return;
  const pending = deviceInitializationPromises.get(deviceId);
  if (pending) {
    await withTimeout(
      pending,
      operationTimeout(deviceId),
      `Initialization of ${deviceId}`,
    );
    return;
  }

  const initialization = initializeDeviceOnce(deviceId).finally(() => {
    if (deviceInitializationPromises.get(deviceId) === initialization) {
      deviceInitializationPromises.delete(deviceId);
    }
  });
  deviceInitializationPromises.set(deviceId, initialization);
  await withTimeout(
    initialization,
    operationTimeout(deviceId),
    `Initialization of ${deviceId}`,
  );
}

function updateDeviceConnectivity(
  driverId: string,
  deviceId: string,
  connected: boolean,
): void {
  const updated = setDeviceConnectivity(twin, driverId, deviceId, connected);
  if (updated === twin) return;
  twin = updated;
  runtimeStore.save(twin);
}

async function initializeDeviceOnce(deviceId: string): Promise<void> {
  const driver = drivers.get(deviceId);
  if (!driver || !twin.devices?.some((device) => device.id === deviceId)) {
    throw new Error(`Device is not registered: ${deviceId}`);
  }
  await driver.connect(deviceId);
  connectedDeviceIds.add(deviceId);

  // A multi-endpoint Matter strip can take more than ten seconds to hydrate
  // every telemetry cluster even though its operational session is already
  // ready for commands. Let the de-duplicated background telemetry refresh do
  // that work instead of blocking the first outlet command after startup.
  if (deviceId.startsWith("matter-")) return;

  const state = await driver.getState(deviceId);
  twin = {
    ...twin,
    equipment: twin.equipment.map((equipment) => {
      const binding = equipment.binding;
      if (!binding || binding.driverId !== driver.id || binding.deviceId !== deviceId || !binding.channelId) {
        return equipment;
      }
      const channel = state.channels[binding.channelId];
      return channel
        ? {
            ...equipment,
            enabled: channel.relayOn === true,
            ...(channel.speedPercent === undefined ? {} : { speedPercent: channel.speedPercent }),
            connectionStatus: "online",
          }
        : equipment;
    }),
  };
  runtimeStore.save(twin);
}

export async function initializeEquipment(): Promise<void> {
  await Promise.allSettled(
    [...drivers.keys()].map((deviceId) => initializeDevice(deviceId)),
  );
}

export interface EquipmentChannelTelemetry {
  relayOn?: boolean;
  watts?: number;
  energyKwh?: number;
  speedPercent?: number;
}

let cachedEquipmentChannelStates: Record<string, EquipmentChannelTelemetry> = {};
let equipmentChannelStatesRefresh: Promise<
  Record<string, EquipmentChannelTelemetry>
> | null = null;
export async function getEquipmentChannelStates(): Promise<
  Record<string, EquipmentChannelTelemetry>
> {
  void refreshDmpConnectivity().catch((error) => {
    console.warn(
      "Could not refresh DMP wavemaker connectivity:",
      error instanceof Error ? error.message : error,
    );
  });
  if (equipmentChannelStatesRefresh) return equipmentChannelStatesRefresh;

  equipmentChannelStatesRefresh = refreshEquipmentChannelStates();
  try {
    return await equipmentChannelStatesRefresh;
  } finally {
    equipmentChannelStatesRefresh = null;
  }
}

async function refreshDmpConnectivity(): Promise<void> {
  if (dmpConnectivityRefresh) return dmpConnectivityRefresh;
  if (Date.now() - dmpConnectivityRefreshedAt < dmpConnectivityRefreshIntervalMilliseconds) return;
  dmpConnectivityRefreshedAt = Date.now();
  dmpConnectivityRefresh = (async () => {
    for (const registration of dmpRegistrations) {
      const driverId = `modreef.jebao-dmp-ble:${registration.deviceId}`;
      try {
        await verifyDmpBleIdentity({
          advertisedName: registration.advertisedName,
          bluetoothAddress: registration.bluetoothAddress,
        }, 8_000);
        updateDeviceConnectivity(driverId, registration.deviceId, true);
      } catch {
        updateDeviceConnectivity(driverId, registration.deviceId, false);
      }
    }
  })().finally(() => {
    dmpConnectivityRefresh = null;
  });
  return dmpConnectivityRefresh;
}

async function refreshEquipmentChannelStates(): Promise<
  Record<string, EquipmentChannelTelemetry>
> {
  await refreshYinmikWaterMeasurements();
  await initializeEquipment();
  const deviceEntries = await Promise.all([...drivers].map(async ([deviceId, driver]) => {
    if (!connectedDeviceIds.has(deviceId)) return [];
    let state;
    try {
      state = await withTimeout(
        driver.getState(deviceId),
        operationTimeout(deviceId),
        `Telemetry refresh for ${deviceId}`,
      );
    } catch (error) {
      console.warn(
        `Could not refresh equipment telemetry for ${deviceId}:`,
        error instanceof Error ? error.message : error,
      );
      updateDeviceConnectivity(driver.id, deviceId, false);
      return twin.equipment.flatMap((equipment) => {
        const binding = equipment.binding;
        const cached = cachedEquipmentChannelStates[equipment.id];
        return binding?.driverId === driver.id
          && binding.deviceId === deviceId
          && cached
          ? [[equipment.id, cached] as [string, EquipmentChannelTelemetry]]
          : [];
      });
    }
    updateDeviceConnectivity(driver.id, deviceId, true);
    const entries: Array<[string, EquipmentChannelTelemetry]> = [];
    for (const equipment of twin.equipment) {
      const binding = equipment.binding;
      if (!binding || binding.driverId !== driver.id || binding.deviceId !== deviceId || !binding.channelId) continue;
      const channel = state.channels[binding.channelId];
      if (channel) entries.push([equipment.id, channel]);
    }
    return entries;
  }));
  cachedEquipmentChannelStates = Object.fromEntries(deviceEntries.flat());
  return { ...cachedEquipmentChannelStates };
}

async function refreshYinmikWaterMeasurements(): Promise<void> {
  await Promise.all([...yinmikTransports].map(async ([deviceId, transport]) => {
    const driverId = `${yinmikWaterDriverPrefix}:${deviceId}`;
    const now = Date.now();
    if (now - (yinmikLastSampleAt.get(deviceId) ?? 0) < 5_000) return;
    try {
      let dps: Record<string, unknown> | undefined;
      try {
        dps = await withTimeout(
          transport.readStatus(),
          deviceOperationTimeoutMilliseconds,
          `Water quality refresh for ${deviceId}`,
        );
      } catch (initialError) {
        const credentials = yinmikCredentials.get(deviceId);
        if (!credentials) throw initialError;

        let recovered = false;
        let networkAddress = credentials.networkAddress;
        try {
          networkAddress = await yinmikDiscovery.findPrivateAddress(deviceId);
        } catch {
          // Retain the last known private address when the UDP broadcast is
          // temporarily unavailable; protocol recovery can still succeed.
        }
        const protocolVersions = credentials.protocolVersion
          ? [credentials.protocolVersion, "3.4", "3.5", "3.3"] as const
          : ["3.4", "3.5", "3.3"] as const;
        for (const protocolVersion of [...new Set(protocolVersions)]) {
          const candidate = new PythonGHomeWp12Transport(
            "scripts/tuya-bridge.py",
            repositoryRoot,
            process.env.MODREEF_PYTHON ?? "python3",
            { ...credentials, networkAddress, protocolVersion },
          );
          try {
            dps = await withTimeout(
              candidate.readStatus(),
              deviceOperationTimeoutMilliseconds,
              `Water quality ${protocolVersion} probe for ${deviceId}`,
            );
            const updatedCredentials = {
              ...credentials,
              networkAddress,
              protocolVersion,
            };
            credentialStore.saveGHomeWp12(updatedCredentials);
            yinmikCredentials.set(deviceId, updatedCredentials);
            yinmikTransports.set(deviceId, candidate);
            console.info(`Water quality device ${deviceId} uses Tuya ${protocolVersion}`);
            recovered = true;
            break;
          } catch {
            // Continue through the bounded protocol compatibility list.
          }
        }
        if (!recovered) throw initialError;
      }
      if (!dps) throw new Error(`Water quality device ${deviceId} returned no telemetry`);
      const instantaneousRawMeasurements = yinmikWaterMeasurements(
        twin.aquarium.id,
        deviceId,
        dps,
        new Date(now).toISOString(),
      );
      yinmikLastSampleAt.set(deviceId, now);
      twin = {
        ...twin,
        equipment: twin.equipment.map((equipment) => {
          if (equipment.binding?.driverId !== driverId) return equipment;
          const rawMeasurementSamples = appendRawWaterSamples(
            equipment.rawMeasurementSamples,
            instantaneousRawMeasurements,
            now,
          );
          const rawLiveMeasurements = filteredWaterMeasurements(
            rawMeasurementSamples,
            new Date(now).toISOString(),
          );
          const liveMeasurements = applyWaterProbeCalibration(
            rawLiveMeasurements,
            equipment.waterProbeCalibration,
          );
          return {
            ...equipment,
            connectionStatus: "online",
            instantaneousRawMeasurements,
            rawMeasurementSamples,
            rawLiveMeasurements,
            liveMeasurements,
            waterMeasurementStability: waterMeasurementStability(rawMeasurementSamples),
            measurementHistory: appendWaterMeasurementHistory(
              equipment.measurementHistory,
              liveMeasurements,
            ),
          };
        }),
      };
      updateDeviceConnectivity(driverId, deviceId, true);
      runtimeStore.save(twin);
    } catch (error) {
      console.warn(
        `Could not refresh water quality telemetry for ${deviceId}:`,
        error instanceof Error ? error.message : error,
      );
      twin = {
        ...twin,
        equipment: twin.equipment.map((equipment) =>
          equipment.binding?.driverId === driverId
            ? { ...equipment, connectionStatus: "offline" }
            : equipment
        ),
      };
      updateDeviceConnectivity(driverId, deviceId, false);
      runtimeStore.save(twin);
    }
  }));
}

export function updateWaterProbeCalibration(
  equipmentId: string,
  calibration: WaterProbeCalibration,
): AquariumDigitalTwin {
  const existing = twin.equipment.find((item) => item.id === equipmentId);
  if (!existing || existing.role !== "sensor") {
    throw new Error(`Water quality sensor not found: ${equipmentId}`);
  }
  const rawLiveMeasurements = existing.rawLiveMeasurements ?? existing.liveMeasurements ?? [];
  twin = {
    ...twin,
    equipment: twin.equipment.map((item) => item.id === equipmentId ? {
      ...item,
      waterProbeCalibration: calibration,
      liveMeasurements: applyWaterProbeCalibration(rawLiveMeasurements, calibration),
    } : item),
  };
  runtimeStore.save(twin);
  return getTwin();
}

export function getCachedEquipmentChannelStates(): Record<
  string,
  EquipmentChannelTelemetry
> {
  return { ...cachedEquipmentChannelStates };
}

export function getTwin(): AquariumDigitalTwin {
  return structuredClone(twin);
}

export function recordAquariumActivity(
  input: AquariumActivityInput,
): void {
  runtimeStore.appendEvent(
    createActivityEvent(twin.aquarium.id, input),
  );
}

function recordEquipmentConfigurationActivity(
  equipmentId: string,
  title: string,
  action: string,
  details?: string,
): void {
  recordAquariumActivity({
    source: "manual",
    category: "equipment",
    action,
    title,
    equipmentId,
    ...(details ? { details } : {}),
  });
}

export interface EquipmentActivityContext {
  source?: "manual" | "automation";
  category?: ActivityCategory;
  action?: string;
  details?: string;
  requestedDoseMilliliters?: number;
  record?: boolean;
}

export function updateAquariumName(
  name: string,
): AquariumDigitalTwin {
  twin = {
    ...twin,
    aquarium: {
      ...twin.aquarium,
      name,
    },
  };

  runtimeStore.save(twin);
  return getTwin();
}

export async function setEquipmentPower(
  equipmentId: string,
  on: boolean,
  context: EquipmentActivityContext = {},
) {
  if (context.source !== "automation") {
    const { cancelPendingAutomaticRestart } = await import(
      "./automation-runtime.js"
    );
    cancelPendingAutomaticRestart(equipmentId);
  }
  const previous = twin.equipment.find(
    (equipment) => equipment.id === equipmentId,
  );
  const dmpRegistration = dmpRegistrations.find(
    ({ deviceId }) => deviceId === previous?.binding?.deviceId,
  );

  if (previous?.binding && dmpRegistration) {
    const dmpController = new DmpBleController(dmpRegistration.bluetoothAddress);
    try {
      await dmpController.connect();
      await dmpController.setPower(on);
      twin = setDeviceConnectivity(
        twin, previous.binding.driverId, dmpRegistration.deviceId, true,
      );
      twin = setTwinEquipmentEnabled(twin, equipmentId, on);
      runtimeStore.save(twin);
    } catch (error) {
      twin = setDeviceConnectivity(
        twin, previous.binding.driverId, dmpRegistration.deviceId, false,
      );
      runtimeStore.save(twin);
      throw error;
    } finally {
      await dmpController.disconnect();
    }
    const updated = twin.equipment.find((equipment) => equipment.id === equipmentId)!;
    if (context.record !== false && previous.enabled !== updated.enabled) {
      recordAquariumActivity({
        source: context.source ?? "manual",
        category: context.category ?? "equipment",
        action: context.action ?? (on ? "turned-on" : "turned-off"),
        title: `${updated.name} turned ${on ? "on" : "off"}`,
        equipmentId,
        ...(context.details ? { details: context.details } : {}),
      });
    }
    return {
      twin: getTwin(),
      equipment: updated,
      operationalState: on ? "running" as const : "off" as const,
      message: `${updated.name} confirmed ${on ? "on" : "off"}`,
    };
  }

  if (
    previous?.binding &&
    !(!on && previous.connectionStatus === "offline")
  ) {
    await initializeDevice(previous.binding.deviceId);
  }

  const result = await controller.setPower(
    twin,
    equipmentId,
    on,
  );

  twin = result.twin;
  runtimeStore.save(twin);

  if (
    context.record !== false &&
    previous &&
    previous.enabled !== result.equipment.enabled
  ) {
    recordAquariumActivity({
      source: context.source ?? "manual",
      category: context.category ?? "equipment",
      action: context.action ?? (on ? "turned-on" : "turned-off"),
      title: `${result.equipment.name} turned ${on ? "on" : "off"}`,
      equipmentId,
      ...(context.details ? { details: context.details } : {}),
    });
  }

  return result;
}

export async function setEquipmentSpeed(
  equipmentId: string,
  percent: number,
  context: EquipmentActivityContext = {},
) {
  const equipment = twin.equipment.find((item) => item.id === equipmentId);
  const dmpRegistration = dmpRegistrations.find(
    ({ deviceId }) => deviceId === equipment?.binding?.deviceId,
  );
  if (equipment && dmpRegistration) {
    const controller = new DmpBleController(dmpRegistration.bluetoothAddress);
    const activeMode = equipment.wavemakerMode ?? "M3";
    const modeSetting = equipment.wavemakerModeSettings?.[activeMode];
    try {
      await controller.connect();
      await controller.setMode(
        activeMode,
        percent,
        activeMode === "M4" ? 100 : modeSetting?.pulseFrequency ?? 100,
      );
      twin = setDeviceConnectivity(
        twin, equipment.binding!.driverId, dmpRegistration.deviceId, true,
      );
    } catch (error) {
      twin = setDeviceConnectivity(
        twin, equipment.binding!.driverId, dmpRegistration.deviceId, false,
      );
      runtimeStore.save(twin);
      throw error;
    } finally {
      await controller.disconnect();
    }
    twin = setTwinEquipmentSpeed(twin, equipmentId, percent);
    runtimeStore.save(twin);
    const updated = twin.equipment.find((item) => item.id === equipmentId)!;
    if (context.record !== false) {
      recordAquariumActivity({
        source: context.source ?? "manual",
        category: context.category ?? "equipment",
        action: context.action ?? "speed-changed",
        title: `${updated.name} set to ${percent}%`,
        equipmentId,
        ...(context.details ? { details: context.details } : {}),
      });
    }
    return {
      twin: getTwin(),
      equipment: updated,
      operationalState: updated.enabled ? "running" as const : "off" as const,
      message: `${updated.name} confirmed at ${percent}%`,
    };
  }
  if (equipment?.binding) await initializeDevice(equipment.binding.deviceId);
  const result = await controller.setSpeed(twin, equipmentId, percent);
  twin = result.twin;
  runtimeStore.save(twin);
  if (context.record !== false) {
    recordAquariumActivity({
      source: context.source ?? "manual",
      category: context.category ?? "equipment",
      action: context.action ?? "speed-changed",
      title: `${result.equipment.name} set to ${percent}%`,
      equipmentId,
      ...(context.details ? { details: context.details } : {}),
    });
  }
  return result;
}

export async function startEquipmentDose(
  equipmentId: string,
  runtimeSeconds: number,
  context: EquipmentActivityContext = {},
) {
  const equipment = twin.equipment.find((item) => item.id === equipmentId);
  if (equipment?.binding) {
    await initializeDevice(equipment.binding.deviceId);
  }

  const result = await controller.startDose(
    twin,
    equipmentId,
    runtimeSeconds,
  );

  twin = result.twin;
  runtimeStore.save(twin);

  if (context.record !== false) {
    const millilitersPerMinute =
      result.equipment.doserCalibration?.millilitersPerMinute;
    const estimatedAmount = millilitersPerMinute
      ? millilitersPerMinute * runtimeSeconds / 60
      : undefined;
    const requestedAmount = context.requestedDoseMilliliters;
    const loggedAmount = requestedAmount ?? estimatedAmount;
    const defaultDetails = requestedAmount !== undefined &&
        estimatedAmount !== undefined
      ? `Requested: ${requestedAmount} mL · Runtime: ${runtimeSeconds} seconds · Estimated delivery: ${Number(estimatedAmount.toFixed(2))} mL`
      : `Runtime: ${runtimeSeconds} seconds`;

    recordAquariumActivity({
      source: context.source ?? "manual",
      category: context.category ?? "equipment",
      action: context.action ?? "dose-started",
      title: loggedAmount === undefined
        ? `${result.equipment.name} ran for ${runtimeSeconds} seconds`
        : requestedAmount === undefined
          ? `${result.equipment.name} estimated dose ${Number(loggedAmount.toFixed(2))} mL`
          : `${result.equipment.name} dosed ${Number(loggedAmount.toFixed(2))} mL`,
      equipmentId,
      details: context.details ?? defaultDetails,
    });
  }

  return result;
}


export async function updateEquipmentControlMode(
  equipmentId: string,
  controlMode: EquipmentControlMode,
): Promise<AquariumDigitalTwin> {
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  if (
    controlMode === "auto" &&
    previous?.programType === "dosing-pump"
  ) {
    // AUTO on a doser means its native schedule owns future starts. A head
    // manually latched ON must be stopped first; the MD-4.4 does not stop it
    // merely because the controller changes its local control mode.
    await setEquipmentPower(equipmentId, false, { record: false });
  } else if (controlMode !== "auto") {
    await setEquipmentPower(
      equipmentId,
      controlMode === "on",
    );
  }

  twin = setTwinEquipmentControlMode(
    twin,
    equipmentId,
    controlMode,
  );

  runtimeStore.save(twin);

  if (controlMode === "auto") {
    const { applyEquipmentSchedules } = await import(
      "./automation-runtime.js"
    );
    await applyEquipmentSchedules();
  }

  if (previous && previous.controlMode !== controlMode) {
    recordEquipmentConfigurationActivity(
      equipmentId,
      `${previous.name} control mode set to ${controlMode.toUpperCase()}`,
      "control-mode-changed",
    );
  }

  return getTwin();
}

export function updateEquipmentConfiguration(
  equipmentId: string,
  name: string,
  role: EquipmentRole,
  automaticRestartDelaySeconds?: number,
  dosingParameter?: DosingParameter,
  dosingParameterName?: string,
): AquariumDigitalTwin {
  if (
    automaticRestartDelaySeconds !== undefined &&
    (!Number.isSafeInteger(automaticRestartDelaySeconds) ||
      automaticRestartDelaySeconds < 0 ||
      automaticRestartDelaySeconds > 1_800)
  ) {
    throw new Error("Automatic restart delay must be between 0 and 1800 seconds");
  }
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  if (!previous) throw new Error(`Equipment not found: ${equipmentId}`);
  const capability = previous.binding?.capability;
  const driverId = previous.binding?.driverId ?? "";
  if (capability === "measurement" && role !== "sensor") {
    throw new Error("Measurement channels are dedicated sensors");
  }
  if (driverId.startsWith("modreef.jebao-md44:") && role !== "doser") {
    throw new Error("MD-4.4 channels are dedicated dosing pumps");
  }
  if (driverId.startsWith("modreef.jebao-mdp:") && role !== "return-pump") {
    throw new Error("Jebao MDP channels are dedicated return pumps");
  }
  if (driverId.startsWith("modreef.jebao-dmp-ble:") && role !== "circulation-pump") {
    throw new Error("Jebao DMP channels are dedicated wavemakers");
  }
  twin = updateEquipmentDetails(twin, equipmentId, {
    name,
    role,
    ...(automaticRestartDelaySeconds === undefined
      ? {}
      : { automaticRestartDelaySeconds }),
    ...(dosingParameter === undefined ? {} : { dosingParameter }),
    ...(dosingParameterName === undefined ? {} : { dosingParameterName }),
  });

  runtimeStore.save(twin);
  if (previous && (previous.name !== name || previous.role !== role)) {
    recordEquipmentConfigurationActivity(
      equipmentId,
      `${name} configuration updated`,
      "configuration-changed",
      `Name: ${previous.name} -> ${name}; role: ${previous.role} -> ${role}`,
    );
  }
  return getTwin();
}

export async function updateWavemakerConfiguration(
  equipmentId: string,
  feedCycleParticipation: boolean,
  linkRole: WavemakerLinkRole,
  mode: WavemakerMode,
  modeSettings?: WavemakerModeSettings,
): Promise<AquariumDigitalTwin> {
  const equipment = twin.equipment.find(({ id }) => id === equipmentId);
  const registration = dmpRegistrations.find(
    ({ deviceId }) => deviceId === equipment?.binding?.deviceId,
  );
  if (!equipment || !registration) {
    throw new Error("DMP-40 registration was not found");
  }
  const controller = new DmpBleController(registration.bluetoothAddress);
  try {
    await controller.connect();
    const setting = modeSettings?.[mode] ?? equipment.wavemakerModeSettings?.[mode];
    await controller.setMode(
      mode,
      setting?.flowPercent ?? equipment.speedPercent ?? 100,
      mode === "M4" ? 100 : setting?.pulseFrequency ?? 100,
    );
    twin = setDeviceConnectivity(
      twin, equipment.binding!.driverId, registration.deviceId, true,
    );
  } catch (error) {
    twin = setDeviceConnectivity(
      twin, equipment.binding!.driverId, registration.deviceId, false,
    );
    runtimeStore.save(twin);
    throw error;
  } finally {
    await controller.disconnect();
  }
  twin = updateTwinWavemakerConfiguration(
    twin, equipmentId, feedCycleParticipation, linkRole, mode, modeSettings,
  );
  runtimeStore.save(twin);
  recordEquipmentConfigurationActivity(
    equipmentId,
    `Wavemaker set to ${mode} / ${linkRole}`,
    "configuration-changed",
    `Feed Cycle participation: ${feedCycleParticipation ? "on" : "off"}`,
  );
  return getTwin();
}

export function updateEquipmentDisplay(
  equipmentId: string,
  displayOrder: number,
  hiddenFromDashboard: boolean,
): AquariumDigitalTwin {
  if (!Number.isSafeInteger(displayOrder) || displayOrder < 0) {
    throw new Error("Invalid equipment display order");
  }
  const equipment = twin.equipment.find((item) => item.id === equipmentId);
  if (!equipment) throw new Error(`Equipment not found: ${equipmentId}`);
  twin = {
    ...twin,
    equipment: twin.equipment.map((item) => item.id === equipmentId
      ? { ...item, displayOrder, hiddenFromDashboard }
      : item),
  };
  runtimeStore.save(twin);
  return getTwin();
}

export function updateEquipmentLayout(
  settings: EquipmentDisplaySetting[],
): AquariumDigitalTwin {
  const ids = new Set<string>();
  const positions = new Set<number>();
  for (const setting of settings) {
    if (!setting.equipmentId || ids.has(setting.equipmentId) || positions.has(setting.displayOrder) ||
        !Number.isSafeInteger(setting.displayOrder) || setting.displayOrder < 0 ||
        typeof setting.hiddenFromDashboard !== "boolean" ||
        !twin.equipment.some((item) => item.id === setting.equipmentId)) {
      throw new Error("Invalid equipment layout");
    }
    ids.add(setting.equipmentId);
    positions.add(setting.displayOrder);
  }
  const byId = new Map(settings.map((setting) => [setting.equipmentId, setting]));
  twin = {
    ...twin,
    equipment: twin.equipment.map((item) => {
      const setting = byId.get(item.id);
      return setting ? {
        ...item,
        displayOrder: setting.displayOrder,
        hiddenFromDashboard: setting.hiddenFromDashboard,
      } : item;
    }),
  };
  runtimeStore.save(twin);
  return getTwin();
}


export function updateEquipmentProgramType(
  equipmentId: string,
  programType: EquipmentProgramType,
): AquariumDigitalTwin {
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  if (
    previous?.binding?.driverId.startsWith("modreef.jebao-md44:") &&
    programType !== "dosing-pump"
  ) throw new Error("MD-4.4 channels are dedicated dosing pumps");
  twin = setTwinEquipmentProgramType(
    twin,
    equipmentId,
    programType,
  );

  runtimeStore.save(twin);
  if (previous && previous.programType !== programType) {
    recordEquipmentConfigurationActivity(
      equipmentId,
      `${previous.name} program set to ${programType}`,
      "program-type-changed",
    );
  }
  return getTwin();
}

export async function updateEquipmentIntervalProgram(
  equipmentId: string,
  intervalProgram: EquipmentIntervalProgram,
): Promise<AquariumDigitalTwin> {
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  if (!previous) throw new Error(`Equipment not found: ${equipmentId}`);
  if (previous.binding?.driverId.startsWith("modreef.jebao-md44:")) {
    const driver = drivers.get(previous.binding.deviceId);
    if (!(driver instanceof JebaoMd44Driver) || !previous.binding.channelId) {
      throw new Error("MD-4.4 driver is not available");
    }
    const native = translateMd44IntervalProgram(intervalProgram);
    await withTimeout(
      (async () => {
        await driver.connect(previous.binding!.deviceId);
        await driver.setNativeSchedule(
          previous.binding!.channelId!, native.dayInterval, native.slots,
          intervalProgram.enabled,
        );
      })(),
      15_000,
      "Timed out saving the program to the MD-4.4",
    );
  }
  twin = setTwinEquipmentIntervalProgram(
    twin,
    equipmentId,
    intervalProgram,
  );

  runtimeStore.save(twin);
  recordEquipmentConfigurationActivity(
    equipmentId,
    `${previous.name} interval program updated`,
    "interval-program-changed",
  );
  return getTwin();
}

export function updateAdvancedOutletProgram(
  equipmentId: string,
  program: AdvancedOutletProgram,
): AquariumDigitalTwin {
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  twin = setTwinAdvancedOutletProgram(twin, equipmentId, program);
  runtimeStore.save(twin);
  if (previous) {
    recordEquipmentConfigurationActivity(
      equipmentId,
      `${previous.name} advanced program revision ${program.revision} saved`,
      "advanced-program-changed",
    );
  }
  return getTwin();
}

export function updateDoserCalibration(
  equipmentId: string,
  calibration: DoserCalibration,
): AquariumDigitalTwin {
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  twin = setTwinDoserCalibration(
    twin,
    equipmentId,
    calibration,
  );

  runtimeStore.save(twin);
  if (previous) {
    recordEquipmentConfigurationActivity(
      equipmentId,
      `${previous.name} calibration updated`,
      "calibration-changed",
    );
  }
  return getTwin();
}

export function updateEquipmentSchedule(
  equipmentId: string,
  schedule: EquipmentSchedule,
): AquariumDigitalTwin {
  const previous = twin.equipment.find((item) => item.id === equipmentId);
  twin = setTwinEquipmentSchedule(
    twin,
    equipmentId,
    schedule,
  );

  runtimeStore.save(twin);
  if (previous) {
    recordEquipmentConfigurationActivity(
      equipmentId,
      `${previous.name} schedule updated`,
      "schedule-changed",
    );
  }
  return getTwin();
}

export function updateEquipmentSpeedSchedule(
  equipmentId: string,
  schedule: EquipmentSpeedSchedule,
): AquariumDigitalTwin {
  twin = setTwinEquipmentSpeedSchedule(twin, equipmentId, schedule);
  runtimeStore.save(twin);
  return getTwin();
}

export function cloneEquipmentConfiguration(
  sourceId: string,
  destinationId: string,
  name: string,
): AquariumDigitalTwin {
  twin = cloneEquipmentConfigurationInTwin(twin, sourceId, destinationId, name);
  runtimeStore.save(twin);
  return getTwin();
}

export async function swapEquipmentBindings(
  firstId: string,
  secondId: string,
): Promise<AquariumDigitalTwin> {
  const first = twin.equipment.find((item) => item.id === firstId);
  const second = twin.equipment.find((item) => item.id === secondId);
  if (!first || !second) throw new Error("Equipment not found");
  const firstEnabled = first.enabled;
  const secondEnabled = second.enabled;

  if (first.binding) await initializeDevice(first.binding.deviceId);
  if (second.binding && second.binding.deviceId !== first.binding?.deviceId) {
    await initializeDevice(second.binding.deviceId);
  }

  const originalTwin = twin;
  try {
    twin = swapEquipmentBindingsInTwin(twin, firstId, secondId);
    twin = (await controller.setPower(twin, firstId, firstEnabled)).twin;
    twin = (await controller.setPower(twin, secondId, secondEnabled)).twin;
    runtimeStore.save(twin);
    return getTwin();
  } catch (error) {
    twin = originalTwin;
    try {
      twin = (await controller.setPower(twin, firstId, firstEnabled)).twin;
      twin = (await controller.setPower(twin, secondId, secondEnabled)).twin;
    } catch {
      // Preserve the last persisted mapping if physical rollback is interrupted.
    }
    throw error;
  }
}


export function registerGHomeWp12Device(
  credentials: GHomeWp12Credentials,
  useLegacyIdentity = false,
  displayName?: string,
): AquariumDigitalTwin {
  const runtimeDeviceId = useLegacyIdentity
    ? legacyDeviceId
    : credentials.deviceId;
  const driver = installDriver(runtimeDeviceId, credentials);
  controller = new EquipmentController([...drivers.values()]);

  if (!twin.devices?.some((device) => device.id === runtimeDeviceId)) {
    twin = {
      ...twin,
      devices: [
        ...(twin.devices ?? []),
        createGHomeWp12Device(twin, driver.id, runtimeDeviceId),
      ],
    };
  }

  twin = ensureGHomeWp12Equipment(twin, driver.id, runtimeDeviceId);
  if (displayName) {
    twin = updatePhysicalDeviceName(twin, runtimeDeviceId, displayName);
  }
  runtimeStore.save(twin);
  connectedDeviceIds.delete(runtimeDeviceId);

  return getTwin();
}

export function registerYinmikWaterDevice(
  credentials: GHomeWp12Credentials,
  displayName?: string,
): AquariumDigitalTwin {
  credentialDeviceIds.set(credentials.deviceId, credentials.deviceId);
  yinmikCredentials.set(credentials.deviceId, credentials);
  yinmikTransports.set(credentials.deviceId, new PythonGHomeWp12Transport(
    "scripts/tuya-bridge.py",
    repositoryRoot,
    process.env.MODREEF_PYTHON ?? "python3",
    { ...credentials, protocolVersion: credentials.protocolVersion ?? "3.4" },
  ));
  twin = addYinmikWaterDevice(
    twin,
    credentials.deviceId,
    displayName ?? "Water Meter",
  );
  runtimeStore.save(twin);
  return getTwin();
}

export function registerMdpPump(
  registration: MdpPumpRegistration,
): AquariumDigitalTwin {
  mdpRegistrations = [
    ...mdpRegistrations.filter(({ deviceId }) => deviceId !== registration.deviceId),
    registration,
  ];
  saveMdpRegistrations();
  installMdpDriver(registration);
  ensureMdpTwin(registration);
  controller = new EquipmentController([...drivers.values()]);
  runtimeStore.save(twin);
  connectedDeviceIds.delete(registration.deviceId);
  return getTwin();
}

export function registerMd44Doser(
  registration: Md44DoserRegistration,
): AquariumDigitalTwin {
  md44Registrations = [
    ...md44Registrations.filter(({ deviceId }) => deviceId !== registration.deviceId),
    registration,
  ];
  runtimeStore.saveState(md44RegistrationsKey, md44Registrations);
  installMd44Driver(registration);
  ensureMd44Twin(registration);
  controller = new EquipmentController([...drivers.values()]);
  runtimeStore.save(twin);
  return getTwin();
}

export function registerDmpWavemaker(
  registration: DmpWavemakerRegistration,
): AquariumDigitalTwin {
  dmpRegistrations = [
    ...dmpRegistrations.filter(({ deviceId }) => deviceId !== registration.deviceId),
    registration,
  ];
  runtimeStore.saveState(dmpRegistrationsKey, dmpRegistrations);
  ensureDmpTwin(registration);
  twin = setDeviceConnectivity(
    twin,
    `modreef.jebao-dmp-ble:${registration.deviceId}`,
    registration.deviceId,
    true,
  );
  runtimeStore.save(twin);
  return getTwin();
}

export async function registerMatterDevice(
  pairingCode: string,
  displayName?: string,
  wifiNetwork?: { ssid: string; password: string },
  compatibilityHint?: "tapo-p316m",
  onProgress?: (stage: MatterCommissioningStage) => void,
): Promise<AquariumDigitalTwin> {
  const registration = await commissionMatterDevice(
    pairingCode,
    wifiNetwork,
    compatibilityHint,
    onProgress,
  );
  drivers.set(registration.deviceId, new MatterOutletDriver(registration.deviceId));
  controller = new EquipmentController([...drivers.values()]);
  twin = addMatterDevice(twin, registration, displayName);
  runtimeStore.save(twin);
  connectedDeviceIds.add(registration.deviceId);
  return getTwin();
}


export async function deletePhysicalDevice(
  physicalDeviceId: string,
): Promise<AquariumDigitalTwin> {
  const physicalDevice = twin.devices?.find((device) => device.id === physicalDeviceId);
  if (!physicalDevice) throw new Error(`Device not found: ${physicalDeviceId}`);
  const childEquipmentIds = twin.equipment
    .filter((equipment) =>
      equipment.physicalDeviceId === physicalDeviceId ||
      equipment.binding?.deviceId === physicalDeviceId
    )
    .map(({ id }) => id);
  const { prepareEquipmentRemoval } = await import("./automation-runtime.js");
  prepareEquipmentRemoval(childEquipmentIds);
  if (physicalDevice?.driverId.startsWith("modreef.matter:")) {
    await removeMatterDevice(physicalDeviceId);
  }

  const credentialDeviceId = physicalDevice?.driverId.startsWith("modreef.ghome.wp12")
    ? ghomeCredentialDeviceIdForRuntime(
        physicalDeviceId,
        credentialStore.listGHomeWp12(),
      )
    : credentialDeviceIds.get(physicalDeviceId) ??
      (physicalDevice?.driverId.startsWith("modreef.yinmik-water:")
        ? physicalDeviceId
        : undefined);
  if (credentialDeviceId) credentialStore.deleteGHomeWp12(credentialDeviceId);

  yinmikCredentials.delete(physicalDeviceId);
  yinmikTransports.delete(physicalDeviceId);
  yinmikLastSampleAt.delete(physicalDeviceId);
  runtimeStore.deleteState(`yinmik-water-initial-dps:${physicalDeviceId}`);
  new OnboardingRegistry(runtimeStore).remove(physicalDeviceId);

  const removedMaster = twin.equipment.some((item) =>
    item.physicalDeviceId === physicalDeviceId && item.wavemakerLinkRole === "master"
  );
  twin = removePhysicalDevice(twin, physicalDeviceId);
  if (removedMaster) {
    twin = {
      ...twin,
      equipment: twin.equipment.map((item) =>
        item.wavemakerLinkRole === "slave"
          ? { ...item, wavemakerLinkRole: "independent" }
          : item
      ),
    };
  }
  runtimeStore.save(twin);
  if (physicalDevice?.driverId.startsWith("modreef.jebao-mdp:")) {
    mdpRegistrations = mdpRegistrations.filter(
      ({ deviceId }) => deviceId !== physicalDeviceId,
    );
    saveMdpRegistrations();
  }
  if (physicalDevice?.driverId.startsWith("modreef.jebao-md44:")) {
    md44Registrations = md44Registrations.filter(
      ({ deviceId }) => deviceId !== physicalDeviceId,
    );
    runtimeStore.saveState(md44RegistrationsKey, md44Registrations);
  }
  if (physicalDevice?.driverId.startsWith("modreef.jebao-dmp-ble:")) {
    dmpRegistrations = dmpRegistrations.filter(
      ({ deviceId }) => deviceId !== physicalDeviceId,
    );
    runtimeStore.saveState(dmpRegistrationsKey, dmpRegistrations);
  }
  credentialDeviceIds.delete(physicalDeviceId);
  connectedDeviceIds.delete(physicalDeviceId);
  drivers.delete(physicalDeviceId);
  controller = new EquipmentController([...drivers.values()]);

  return getTwin();
}

function installMdpDriver(registration: MdpPumpRegistration): void {
  drivers.set(registration.deviceId, new JebaoMdpDriver(
    registration.deviceId,
    new TcpMdpTransport(registration.networkAddress, {
      resolveHost: async () => {
        const discovered = (await discoverMdpPumps(3_000))
          .find(({ deviceId }) => deviceId === registration.deviceId);
        if (discovered && discovered.networkAddress !== registration.networkAddress) {
          registration.networkAddress = discovered.networkAddress;
          saveMdpRegistrations();
        }
        return registration.networkAddress;
      },
    }),
    `modreef.jebao-mdp:${registration.deviceId}`,
    registration.model,
    registration.displayName,
  ));
}

function installMd44Driver(registration: Md44DoserRegistration): void {
  drivers.set(registration.deviceId, new JebaoMd44Driver(
    registration.deviceId,
    new TcpJebaoMd44Transport(registration.networkAddress),
    `modreef.jebao-md44:${registration.deviceId}`,
    registration.displayName,
  ));
}

function ensureMdpTwin(registration: MdpPumpRegistration): void {
  const driverId = `modreef.jebao-mdp:${registration.deviceId}`;
  if (!twin.devices?.some(({ id }) => id === registration.deviceId)) {
    twin = {
      ...twin,
      devices: [...(twin.devices ?? []), {
        id: registration.deviceId,
        aquariumId: twin.aquarium.id,
        name: registration.displayName,
        manufacturer: "Jebao / Jecod",
        model: registration.model,
        driverId,
        connectionStatus: "unknown",
        createdAt: new Date().toISOString(),
      }],
    };
  }
  if (!twin.equipment.some(({ binding }) => binding?.deviceId === registration.deviceId)) {
    twin = {
      ...twin,
      equipment: [...twin.equipment, {
        id: `${registration.deviceId}-pump`,
        aquariumId: twin.aquarium.id,
        name: registration.displayName,
        role: "return-pump",
        enabled: false,
        controlMode: "auto",
        programType: "return-pump",
        speedPercent: 30,
        connectionStatus: "unknown",
        healthStatus: "normal",
        physicalDeviceId: registration.deviceId,
        physicalDeviceName: registration.displayName,
        binding: {
          driverId,
          deviceId: registration.deviceId,
          channelId: "pump",
          capability: "speed",
        },
      }],
    };
  }
}

function ensureDmpTwin(registration: DmpWavemakerRegistration): void {
  const driverId = `modreef.jebao-dmp-ble:${registration.deviceId}`;
  twin = {
    ...twin,
    ...(twin.devices ? {
      devices: twin.devices.map((device) =>
        device.id === registration.deviceId && device.driverId === driverId
          ? { ...device, connectionStatus: "unknown" }
          : device
      ),
    } : {}),
    equipment: twin.equipment.map((equipment) =>
      equipment.binding?.deviceId === registration.deviceId &&
        equipment.binding.driverId === driverId
        ? { ...equipment, connectionStatus: "unknown" }
        : equipment
    ),
  };
  if (!twin.devices?.some(({ id }) => id === registration.deviceId)) {
    twin = {
      ...twin,
      devices: [...(twin.devices ?? []), {
        id: registration.deviceId,
        aquariumId: twin.aquarium.id,
        name: registration.displayName,
        manufacturer: "Jebao / Jecod",
        model: "DMP-40",
        driverId,
        connectionStatus: "unknown",
        createdAt: new Date().toISOString(),
      }],
    };
  }
  if (!twin.equipment.some(({ binding }) => binding?.deviceId === registration.deviceId)) {
    twin = {
      ...twin,
      equipment: [...twin.equipment, {
        id: `${registration.deviceId}-wavemaker`,
        aquariumId: twin.aquarium.id,
        name: registration.displayName,
        role: "circulation-pump",
        enabled: false,
        controlMode: "off",
        programType: "always-on",
        supportedProgramTypes: ["always-on"],
        programTypeLocked: true,
        speedPercent: 30,
        feedCycleParticipation: true,
        wavemakerLinkRole: "independent",
        wavemakerMode: "M3",
        connectionStatus: "unknown",
        healthStatus: "normal",
        physicalDeviceId: registration.deviceId,
        physicalDeviceName: registration.displayName,
        binding: {
          driverId,
          deviceId: registration.deviceId,
          channelId: "pump",
          capability: "speed",
        },
      }],
    };
  }
}

function loadDmpRegistrations(): DmpWavemakerRegistration[] {
  const stored = runtimeStore.loadState<unknown>(dmpRegistrationsKey);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is DmpWavemakerRegistration =>
    typeof item === "object" && item !== null &&
    "deviceId" in item && typeof item.deviceId === "string" &&
    /^dmp-[0-9a-f]{4,12}$/i.test(item.deviceId) &&
    "displayName" in item && typeof item.displayName === "string" &&
    "advertisedName" in item && typeof item.advertisedName === "string"
    && "bluetoothAddress" in item && typeof item.bluetoothAddress === "string" &&
    /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(item.bluetoothAddress)
  );
}

function ensureMd44Twin(registration: Md44DoserRegistration): void {
  const driverId = `modreef.jebao-md44:${registration.deviceId}`;
  if (!twin.devices?.some(({ id }) => id === registration.deviceId)) {
    twin = {
      ...twin,
      devices: [...(twin.devices ?? []), {
        id: registration.deviceId,
        aquariumId: twin.aquarium.id,
        name: registration.displayName,
        manufacturer: "Jebao / Jecod",
        model: "MD-4.4",
        driverId,
        connectionStatus: "unknown",
        createdAt: new Date().toISOString(),
      }],
    };
  }
  const existingChannels = new Set(
    twin.equipment
      .filter(({ binding }) => binding?.deviceId === registration.deviceId)
      .map(({ binding }) => binding?.channelId),
  );
  twin = {
    ...twin,
    equipment: twin.equipment.map((item) =>
      item.binding?.deviceId === registration.deviceId
        ? {
            ...item,
            role: "doser" as const,
            programType: "dosing-pump" as const,
            supportedProgramTypes: ["dosing-pump" as const],
            programTypeLocked: true,
          }
        : item
    ),
  };
  const additions = Array.from({ length: 4 }, (_, index) => index + 1)
    .filter((head) => !existingChannels.has(`head-${head}`))
    .map((head) => ({
      id: `${registration.deviceId}-head-${head}`,
      aquariumId: twin.aquarium.id,
      name: `Doser ${head}`,
      role: "doser" as const,
      enabled: false,
      controlMode: "auto" as const,
      programType: "dosing-pump" as const,
      supportedProgramTypes: ["dosing-pump" as const],
      programTypeLocked: true,
      connectionStatus: "unknown" as const,
      healthStatus: "normal" as const,
      physicalDeviceId: registration.deviceId,
      physicalDeviceName: registration.displayName,
      binding: {
        driverId,
        deviceId: registration.deviceId,
        channelId: `head-${head}`,
        capability: "power" as const,
      },
    }));
  if (additions.length) twin = { ...twin, equipment: [...twin.equipment, ...additions] };
}

function loadMd44Registrations(): Md44DoserRegistration[] {
  const stored = runtimeStore.loadState<unknown>(md44RegistrationsKey);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is Md44DoserRegistration =>
    typeof item === "object" && item !== null &&
    "deviceId" in item && typeof item.deviceId === "string" &&
    /^md44-[0-9a-f]{12}$/i.test(item.deviceId) &&
    "networkAddress" in item && typeof item.networkAddress === "string" &&
    "displayName" in item && typeof item.displayName === "string" &&
    "gizwitsDeviceId" in item && typeof item.gizwitsDeviceId === "string"
  );
}

function loadMdpRegistrations(): MdpPumpRegistration[] {
  const stored = runtimeStore.loadState<unknown>(mdpRegistrationsKey);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item): item is MdpPumpRegistration =>
    typeof item === "object" && item !== null &&
    "deviceId" in item && typeof item.deviceId === "string" &&
    /^mdp-[0-9a-f]{12}$/i.test(item.deviceId) &&
    "networkAddress" in item && typeof item.networkAddress === "string" &&
    "displayName" in item && typeof item.displayName === "string" &&
    "model" in item && (item.model === "MDP-8500" || item.model === "MDP-20000")
  );
}

function saveMdpRegistrations(): void {
  runtimeStore.saveState(mdpRegistrationsKey, mdpRegistrations);
}

export function renamePhysicalDevice(
  physicalDeviceId: string,
  name: string,
): AquariumDigitalTwin {
  twin = updatePhysicalDeviceName(twin, physicalDeviceId, name);
  runtimeStore.save(twin);
  return getTwin();
}
