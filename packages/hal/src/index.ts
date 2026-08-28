import type {
  ExecutionLocation,
  Identifier,
  IsoDateTime,
} from "@modreef/foundation";

export type DeviceProtocol =
  | "tuya-wifi"
  | "tuya-cloud"
  | "bluetooth"
  | "mqtt"
  | "matter"
  | "apex"
  | "hydros"
  | "proprietary"
  | "simulator";

export type DeviceConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "degraded"
  | "unavailable";

export type CapabilityKind =
  | "relay"
  | "power-monitoring"
  | "energy-monitoring"
  | "schedule"
  | "countdown"
  | "variable-speed"
  | "temperature"
  | "ph"
  | "orp"
  | "salinity"
  | "flow";

export interface CapabilityBase {
  kind: CapabilityKind;
  executionLocation: ExecutionLocation;
  internetRequired: boolean;
}

export interface RelayCapability extends CapabilityBase {
  kind: "relay";
  reportsState: boolean;
  supportsAutoOff: boolean;
  minimumAutoOffSeconds?: number;
  maximumAutoOffSeconds?: number;
}

export interface PowerMonitoringCapability extends CapabilityBase {
  kind: "power-monitoring";
  reportsWatts: boolean;
  reportsVolts: boolean;
  reportsAmps: boolean;
  perChannel: boolean;
}

export interface EnergyMonitoringCapability extends CapabilityBase {
  kind: "energy-monitoring";
  reportsKwh: boolean;
  perChannel: boolean;
}

export interface ScheduleCapability extends CapabilityBase {
  kind: "schedule";
  runsWithoutApp: boolean;
  runsWithoutInternet: boolean;
  timingResolutionSeconds: number;
  maximumEvents: number;
  supportsWeekdays: boolean;
  survivesPowerLoss: boolean | "unknown";
}

export interface CountdownCapability extends CapabilityBase {
  kind: "countdown";
  minimumSeconds: number;
  maximumSeconds: number;
  runsWithoutApp: boolean;
}

export interface VariableSpeedCapability extends CapabilityBase {
  kind: "variable-speed";
  minimumPercent: number;
  maximumPercent: number;
  stepPercent: number;
}

export interface SensorCapability extends CapabilityBase {
  kind:
    | "temperature"
    | "ph"
    | "orp"
    | "salinity"
    | "flow";
  unit: string;
  minimumValue?: number;
  maximumValue?: number;
  resolution?: number;
}

export type DeviceCapability =
  | RelayCapability
  | PowerMonitoringCapability
  | EnergyMonitoringCapability
  | ScheduleCapability
  | CountdownCapability
  | VariableSpeedCapability
  | SensorCapability;

export interface DeviceChannel {
  id: Identifier;
  name: string;
  channelNumber?: number;
  capabilities: DeviceCapability[];
}

export interface DeviceDescriptor {
  id: Identifier;
  driverId: Identifier;
  manufacturer: string;
  model: string;
  displayName: string;
  protocol: DeviceProtocol;
  firmwareVersion?: string;
  serialNumber?: string;
  channels: DeviceChannel[];
}

export interface DeviceState {
  deviceId: Identifier;
  connectionState: DeviceConnectionState;
  observedAt: IsoDateTime;
  channels: Record<Identifier, ChannelState>;
}

export interface ChannelState {
  relayOn?: boolean;
  watts?: number;
  volts?: number;
  amps?: number;
  energyKwh?: number;
  speedPercent?: number;
  measurement?: {
    value: number;
    unit: string;
  };
}

export interface SetRelayCommand {
  type: "set-relay";
  deviceId: Identifier;
  channelId: Identifier;
  on: boolean;
}

export interface SetSpeedCommand {
  type: "set-speed";
  deviceId: Identifier;
  channelId: Identifier;
  percent: number;
}

export interface StartCountdownCommand {
  type: "start-countdown";
  deviceId: Identifier;
  channelId: Identifier;
  seconds: number;
  finalRelayState: boolean;
}

export interface ScheduleEvent {
  id: Identifier;
  channelId: Identifier;
  weekdays: number[];
  time: string;
  relayOn: boolean;
  autoOffSeconds?: number;
}

export interface ReplaceScheduleCommand {
  type: "replace-schedule";
  deviceId: Identifier;
  events: ScheduleEvent[];
}

export type DeviceCommand =
  | SetRelayCommand
  | SetSpeedCommand
  | StartCountdownCommand
  | ReplaceScheduleCommand;

export interface CommandResult {
  commandId: Identifier;
  deviceId: Identifier;
  accepted: boolean;
  completed: boolean;
  message?: string;
  resultingState?: DeviceState;
  completedAt?: IsoDateTime;
}

export interface DriverHealth {
  driverId: Identifier;
  healthy: boolean;
  checkedAt: IsoDateTime;
  message?: string;
}

export interface DeviceDriver {
  readonly id: Identifier;
  readonly name: string;

  discover(): Promise<DeviceDescriptor[]>;

  connect(deviceId: Identifier): Promise<void>;

  disconnect(deviceId: Identifier): Promise<void>;

  getDescriptor(deviceId: Identifier): Promise<DeviceDescriptor>;

  getState(deviceId: Identifier): Promise<DeviceState>;

  execute(
    command: DeviceCommand,
  ): Promise<CommandResult>;

  health(): Promise<DriverHealth>;
}

export function getChannelCapability<T extends DeviceCapability["kind"]>(
  channel: DeviceChannel,
  kind: T,
): Extract<DeviceCapability, { kind: T }> | undefined {
  return channel.capabilities.find(
    (capability): capability is Extract<
      DeviceCapability,
      { kind: T }
    > => capability.kind === kind,
  );
}

export function assertCommandSupported(
  descriptor: DeviceDescriptor,
  command: DeviceCommand,
): void {
  const channelId =
    command.type === "replace-schedule"
      ? undefined
      : command.channelId;

  if (channelId) {
    const channel = descriptor.channels.find(
      (candidate) => candidate.id === channelId,
    );

    if (!channel) {
      throw new Error(
        `Channel not found: ${descriptor.id}/${channelId}`,
      );
    }

    const requiredCapability: CapabilityKind =
      command.type === "set-relay"
        ? "relay"
        : command.type === "set-speed"
          ? "variable-speed"
          : "countdown";

    if (
      !channel.capabilities.some(
        (capability) => capability.kind === requiredCapability,
      )
    ) {
      throw new Error(
        `Channel ${channelId} does not support ${requiredCapability}`,
      );
    }

    return;
  }

  const supportsSchedule = descriptor.channels.some((channel) =>
    channel.capabilities.some(
      (capability) => capability.kind === "schedule",
    ),
  );

  if (!supportsSchedule) {
    throw new Error(
      `Device ${descriptor.id} does not support schedules`,
    );
  }
}
