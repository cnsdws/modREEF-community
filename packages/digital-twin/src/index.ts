import type {
  ConnectionStatus,
  HealthStatus,
  Identifier,
  IsoDateTime,
} from "@modreef/foundation";

export * from "./advanced-outlet-program";

export type AquariumSystemType =
  | "reef"
  | "fish-only"
  | "quarantine"
  | "coral-quarantine"
  | "hospital";

export type EquipmentRole =
  | "return-pump"
  | "circulation-pump"
  | "light"
  | "heater"
  | "skimmer"
  | "doser"
  | "sensor"
  | "outlet"
  | "uv"
  | "ato"
  | "other";

export type EquipmentControlMode =
  | "off"
  | "auto"
  | "on";

export type WaterParameter =
  | "temperature"
  | "salinity"
  | "ph"
  | "orp"
  | "alkalinity"
  | "calcium"
  | "magnesium"
  | "potassium"
  | "iodine"
  | "nitrate"
  | "phosphate"
  | "iron"
  | "other";

export type DosingParameter =
  | "alkalinity"
  | "calcium"
  | "magnesium"
  | "potassium"
  | "iodine"
  | "nitrate"
  | "phosphate"
  | "iron"
  | "other";

export interface Aquarium {
  id: Identifier;
  name: string;
  description: string;
  displayVolumeGallons: number;
  totalSystemVolumeGallons?: number;
  systemType: AquariumSystemType;
  createdAt: IsoDateTime;
}

export interface PhysicalDevice {
  id: Identifier;
  aquariumId: Identifier;
  name: string;
  manufacturer: string;
  model: string;
  driverId: Identifier;
  connectionStatus: ConnectionStatus;
  createdAt: IsoDateTime;
}

export interface DeviceBinding {
  driverId: Identifier;
  deviceId: Identifier;
  channelId?: Identifier;
  capability: "power" | "speed" | "schedule" | "measurement";
}

export type EquipmentProgramType =
  | "always-on"
  | "schedule"
  | "light-schedule"
  | "heater"
  | "return-pump"
  | "skimmer"
  | "dosing-pump"
  | "advanced";

export interface EquipmentIntervalProgram {
  enabled: boolean;
  startTime: string;
  durationSeconds: number;
  doseMilliliters?: number;
  intervalSeconds: number;
  weekdays: number[];
  fallbackState: "off";
  maximumDailyRuntimeSeconds: number;
  maximumDailyDoseMilliliters?: number;
}

export interface DoserCalibration {
  millilitersPerMinute: number;
  calibratedAt: IsoDateTime;
  recalibrationMonths: 6 | 12;
  dueAt: IsoDateTime;
}

export function getDosingRuntimeSeconds(
  calibration: DoserCalibration,
  doseMilliliters: number,
): number {
  if (
    !Number.isFinite(doseMilliliters) ||
    doseMilliliters <= 0 ||
    !Number.isFinite(calibration.millilitersPerMinute) ||
    calibration.millilitersPerMinute <= 0
  ) {
    throw new Error("Dose and calibration rate must be positive numbers");
  }

  return Math.max(
    1,
    Math.ceil(
      (doseMilliliters / calibration.millilitersPerMinute) * 60,
    ),
  );
}

export interface EquipmentScheduleEvent {
  id: Identifier;
  weekdays: number[];
  time: string;
  desiredEnabled: boolean;
}

export interface EquipmentSchedule {
  enabled: boolean;
  events: EquipmentScheduleEvent[];
}

export interface EquipmentSpeedScheduleEvent {
  id: Identifier;
  weekdays: number[];
  time: string;
  speedPercent: number;
}

export interface EquipmentSpeedSchedule {
  enabled: boolean;
  events: EquipmentSpeedScheduleEvent[];
}

export type WavemakerLinkRole = "independent" | "master" | "slave";
export type WavemakerMode = "M1" | "M2" | "M3" | "M4" | "M5";
export interface WavemakerModeSetting {
  flowPercent: number;
  pulseFrequency?: number;
}
export type WavemakerModeSettings = Partial<Record<WavemakerMode, WavemakerModeSetting>>;

export interface Equipment {
  id: Identifier;
  displayOrder?: number;
  hiddenFromDashboard?: boolean;
  aquariumId: Identifier;
  name: string;
  role: EquipmentRole;
  enabled: boolean;
  controlMode?: EquipmentControlMode;
  programType?: EquipmentProgramType;
  /** Program types supported by the physical equipment channel. */
  supportedProgramTypes?: EquipmentProgramType[];
  /** Prevent clients from changing this channel to another program type. */
  programTypeLocked?: boolean;
  /** Delay before this equipment is restarted by an automatic workflow. */
  automaticRestartDelaySeconds?: number;
  schedule?: EquipmentSchedule;
  speedSchedule?: EquipmentSpeedSchedule;
  intervalProgram?: EquipmentIntervalProgram;
  advancedOutletProgram?: import("./advanced-outlet-program").AdvancedOutletProgram;
  doserCalibration?: DoserCalibration;
  dosingParameter?: DosingParameter;
  dosingParameterName?: string;
  connectionStatus: ConnectionStatus;
  healthStatus: HealthStatus;
  physicalConnectionId?: Identifier;
  physicalDeviceName?: string;
  physicalDeviceId?: Identifier;
  /** Public, non-secret description of what the physical channel can do. */
  physicalCapability?: DeviceBinding["capability"];
  powerWatts?: number;
  energyKwh?: number;
  speedPercent?: number;
  feedCycleParticipation?: boolean;
  wavemakerLinkRole?: WavemakerLinkRole;
  wavemakerMode?: WavemakerMode;
  wavemakerModeSettings?: WavemakerModeSettings;
  binding?: DeviceBinding;
  /** Latest transient sensor readings; these are not journal history. */
  liveMeasurements?: WaterMeasurement[];
  /** Latest instantaneous unfiltered probe readings. */
  instantaneousRawMeasurements?: WaterMeasurement[];
  /** Rolling raw samples retained for one-minute filtering. */
  rawMeasurementSamples?: WaterMeasurement[];
  rawLiveMeasurements?: WaterMeasurement[];
  waterMeasurementStability?: Partial<Record<WaterParameter, WaterMeasurementStability>>;
  /** Bounded sensor samples used for the rolling 24-hour display. */
  measurementHistory?: WaterMeasurement[];
  waterProbeCalibration?: WaterProbeCalibration;
}

export interface EquipmentDisplaySetting {
  equipmentId: Identifier;
  displayOrder: number;
  hiddenFromDashboard: boolean;
}

/** Distinguishes a telemetry source from equipment merely classified as a sensor. */
export function isMeasurementEquipment(
  equipment: Pick<
    Equipment,
    "binding" | "physicalCapability" | "role" | "liveMeasurements" | "measurementHistory"
  >,
): boolean {
  const capability = equipment.binding?.capability ?? equipment.physicalCapability;
  if (capability !== undefined) return capability === "measurement";
  return equipment.role === "sensor" &&
    (equipment.liveMeasurements !== undefined || equipment.measurementHistory !== undefined);
}

export function updateWavemakerConfiguration(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  feedCycleParticipation: boolean,
  linkRole: WavemakerLinkRole,
  mode: WavemakerMode,
  modeSettings?: WavemakerModeSettings,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);
  if (!existing) throw new Error(`Equipment not found: ${equipmentId}`);
  if (existing.role !== "circulation-pump") {
    throw new Error("Only a wavemaker can use wavemaker configuration");
  }
  const master = twin.equipment.find((item) =>
    item.aquariumId === existing.aquariumId &&
    item.id !== equipmentId &&
    item.wavemakerLinkRole === "master"
  );
  if (linkRole === "master" && master) {
    throw new Error(`${master.name} is already the master wavemaker`);
  }
  if (linkRole === "slave" && !master) {
    throw new Error("Select a master wavemaker before assigning a slave");
  }
  return {
    ...twin,
    equipment: twin.equipment.map((item) => {
      if (item.id === equipmentId) {
        return {
          ...item,
          feedCycleParticipation,
          wavemakerLinkRole: linkRole,
          wavemakerMode: mode,
          ...(modeSettings ? { wavemakerModeSettings: modeSettings } : {}),
        };
      }
      if (
        existing.wavemakerLinkRole === "master" &&
        linkRole !== "master" &&
        item.aquariumId === existing.aquariumId &&
        item.wavemakerLinkRole === "slave"
      ) {
        return { ...item, wavemakerLinkRole: "independent" };
      }
      return item;
    }),
  };
}

export interface WaterMeasurement {
  id: Identifier;
  aquariumId: Identifier;
  parameter: WaterParameter;
  value: number;
  unit: string;
  measuredAt: IsoDateTime;
  source: "manual" | "sensor" | "imported";
}

export interface WaterCalibrationPoint {
  raw: number;
  reference: number;
  capturedAt: IsoDateTime;
}

export interface WaterProbeCalibration {
  temperature?: { offset: number; calibratedAt: IsoDateTime };
  ph?: { points: WaterCalibrationPoint[]; calibratedAt: IsoDateTime };
  orp?: { offset: number; reference: 256 | 400; calibratedAt: IsoDateTime };
  salinity?: { scale: number; reference: number; calibratedAt: IsoDateTime };
}

export interface WaterMeasurementStability {
  sampleCount: number;
  windowStartedAt: IsoDateTime;
  range: number;
  stable: boolean;
}

export interface ReefRecommendation {
  id: Identifier;
  aquariumId: Identifier;
  title: string;
  summary: string;
  confidence: number;
  severity: "information" | "suggestion" | "warning" | "critical";
  status: "new" | "reviewed" | "accepted" | "dismissed";
  createdAt: IsoDateTime;
}

export type AquariumEventSource =
  | "manual"
  | "sensor"
  | "automation"
  | "imported";

export interface AquariumEventBase {
  id: string;
  aquariumId: string;
  occurredAt: IsoDateTime;
  recordedAt: IsoDateTime;
  source: AquariumEventSource;
  notes?: string;
}

export interface MeasurementEvent extends AquariumEventBase {
  type: "measurement";
  parameter: WaterParameter;
  name?: string;
  value: number;
  unit: string;
  testKit?: {
    brand: string;
    product?: string;
    lot?: string;
    rawReading?: number;
    secondaryRawReading?: number;
    resolution?: string;
  };
}

export type DoseCategory =
  | "alkalinity"
  | "calcium"
  | "magnesium"
  | "potassium"
  | "nitrate"
  | "phosphate"
  | "amino-acid"
  | "trace-element"
  | "other";

export interface DoseEvent extends AquariumEventBase {
  type: "dose";
  product: string;
  category: DoseCategory;
  amount: number;
  unit: string;
  method: "manual" | "dosing-pump";
  equipmentId?: string;
}

export interface FeedingEvent extends AquariumEventBase {
  type: "feeding";
  food: string;
  amount?: number;
  unit?: string;
  method: "manual" | "automatic";
  equipmentId?: string;
}

export interface MaintenanceEvent extends AquariumEventBase {
  type: "maintenance";
  activity: string;
  details?: string;
}

export interface ObservationEvent extends AquariumEventBase {
  type: "observation";
  observation: string;
  category?: string;
}

export type ActivityCategory =
  | "equipment"
  | "automation"
  | "feed-cycle"
  | "routine"
  | "alert";

export interface ActivityEvent extends AquariumEventBase {
  type: "activity";
  category: ActivityCategory;
  action: string;
  title: string;
  details?: string;
  equipmentId?: string;
  alertId?: string;
}

export type AquariumEvent =
  | MeasurementEvent
  | DoseEvent
  | FeedingEvent
  | MaintenanceEvent
  | ObservationEvent
  | ActivityEvent;

export interface AquariumDigitalTwin {
  aquarium: Aquarium;
  devices?: PhysicalDevice[];
  equipment: Equipment[];
  measurements: WaterMeasurement[];
  recommendations: ReefRecommendation[];
}

export function getEquipmentSummary(twin: AquariumDigitalTwin) {
  return {
    total: twin.equipment.length,
    online: twin.equipment.filter((item) => item.connectionStatus === "online").length,
    enabled: twin.equipment.filter((item) => item.enabled).length,
    needingAttention: twin.equipment.filter(
      (item) =>
        item.healthStatus === "attention" ||
        item.healthStatus === "warning" ||
        item.healthStatus === "critical",
    ).length,
  };
}

export function getEquipmentById(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
): Equipment | undefined {
  return twin.equipment.find((equipment) => equipment.id === equipmentId);
}

export function setEquipmentEnabled(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  enabled: boolean,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            enabled,
          }
        : equipment,
    ),
  };
}

export function setEquipmentSpeed(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  speedPercent: number,
): AquariumDigitalTwin {
  if (!Number.isInteger(speedPercent) || speedPercent < 0 || speedPercent > 100) {
    throw new Error("Equipment speed must be an integer from 0 through 100 percent");
  }
  if (!getEquipmentById(twin, equipmentId)) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }
  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId ? { ...equipment, speedPercent } : equipment
    ),
  };
}

export function getEquipmentControlMode(
  equipment: Equipment,
): EquipmentControlMode {
  return equipment.controlMode ?? "auto";
}

export function setEquipmentControlMode(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  controlMode: EquipmentControlMode,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            controlMode,
          }
        : equipment,
    ),
  };
}

export function setEquipmentProgramType(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  programType: EquipmentProgramType,
): AquariumDigitalTwin {
  const current = twin.equipment.find((item) => item.id === equipmentId);
  if (
    current?.programTypeLocked &&
    current.supportedProgramTypes &&
    !current.supportedProgramTypes.includes(programType)
  ) {
    throw new Error(
      `${current.name} only supports ${current.supportedProgramTypes.join(", ")}`,
    );
  }
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            programType,
            ...(programType === "dosing-pump"
              ? { role: "doser" as const }
              : {}),
          }
        : equipment,
    ),
  };
}

export function setEquipmentIntervalProgram(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  intervalProgram: EquipmentIntervalProgram,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            ...(existing.programType === "dosing-pump"
              ? { role: "doser" as const }
              : {}),
            intervalProgram: {
              ...structuredClone(intervalProgram),
              enabled:
                existing.programType === "dosing-pump"
                  ? true
                  : intervalProgram.enabled,
            },
          }
        : equipment,
    ),
  };
}

export function setAdvancedOutletProgram(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  program: import("./advanced-outlet-program").AdvancedOutletProgram,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);
  if (!existing) throw new Error(`Equipment not found: ${equipmentId}`);
  if (existing.programType !== "advanced") {
    throw new Error(`Equipment is not configured for an advanced program: ${equipmentId}`);
  }
  const current = existing.advancedOutletProgram;
  if (current && program.revision < current.revision) {
    throw new Error(`Advanced program revision is stale: ${program.revision}`);
  }
  if (current && program.revision === current.revision &&
    JSON.stringify(current) !== JSON.stringify(program)) {
    throw new Error(`Advanced program revision conflicts: ${program.revision}`);
  }
  return {
    ...twin,
    equipment: twin.equipment.map((equipment) => {
      if (equipment.id !== equipmentId) return equipment;
      const { intervalProgram: _legacyIntervalProgram, ...advancedEquipment } = equipment;
      return { ...advancedEquipment, advancedOutletProgram: structuredClone(program) };
    }),
  };
}

export function setDoserCalibration(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  calibration: DoserCalibration,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  if (existing.programType !== "dosing-pump") {
    throw new Error(`Equipment is not configured as a doser: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            doserCalibration: structuredClone(calibration),
          }
        : equipment,
    ),
  };
}

export function setEquipmentSchedule(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  schedule: EquipmentSchedule,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            schedule: structuredClone(schedule),
          }
        : equipment,
    ),
  };
}

export function setEquipmentSpeedSchedule(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  speedSchedule: EquipmentSpeedSchedule,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);
  if (!existing) throw new Error(`Equipment not found: ${equipmentId}`);
  if (existing.binding?.capability !== "speed") {
    throw new Error(`Equipment is not configured for variable speed: ${equipmentId}`);
  }
  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? { ...equipment, speedSchedule: structuredClone(speedSchedule) }
        : equipment
    ),
  };
}

export function toggleEquipmentEnabled(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return setEquipmentEnabled(twin, equipmentId, !existing.enabled);
}

export function updateEquipmentDetails(
  twin: AquariumDigitalTwin,
  equipmentId: Identifier,
  updates: Pick<Equipment, "name" | "role"> &
    Partial<Pick<Equipment,
      "automaticRestartDelaySeconds" | "dosingParameter" | "dosingParameterName"
    >>,
): AquariumDigitalTwin {
  const existing = getEquipmentById(twin, equipmentId);

  if (!existing) {
    throw new Error(`Equipment not found: ${equipmentId}`);
  }

  return {
    ...twin,
    equipment: twin.equipment.map((equipment) =>
      equipment.id === equipmentId
        ? {
            ...equipment,
            name: updates.name,
            role: updates.role,
            ...(updates.automaticRestartDelaySeconds === undefined
              ? {}
              : {
                  automaticRestartDelaySeconds:
                    updates.automaticRestartDelaySeconds,
                }),
            ...(updates.dosingParameter === undefined
              ? {}
              : { dosingParameter: updates.dosingParameter }),
            ...(updates.dosingParameterName === undefined
              ? {}
              : { dosingParameterName: updates.dosingParameterName }),
          }
        : equipment,
    ),
  };
}

export function updatePhysicalDeviceName(
  twin: AquariumDigitalTwin,
  deviceId: Identifier,
  name: string,
): AquariumDigitalTwin {
  const devices = twin.devices ?? [];

  if (!devices.some((device) => device.id === deviceId)) {
    throw new Error(`Device not found: ${deviceId}`);
  }

  return {
    ...twin,
    devices: devices.map((device) =>
      device.id === deviceId
        ? {
            ...device,
            name,
          }
        : device,
    ),
  };
}


export function removePhysicalDevice(
  twin: AquariumDigitalTwin,
  deviceId: Identifier,
): AquariumDigitalTwin {
  const devices = twin.devices ?? [];

  if (!devices.some((device) => device.id === deviceId)) {
    throw new Error(`Device not found: ${deviceId}`);
  }

  return {
    ...twin,
    devices: devices.filter((device) => device.id !== deviceId),
    equipment: twin.equipment.filter(
      (equipment) =>
        equipment.physicalDeviceId !== deviceId &&
        equipment.binding?.deviceId !== deviceId,
    ),
  };
}
