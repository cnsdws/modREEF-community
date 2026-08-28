import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
  ScheduleEvent,
} from "@modreef/hal";

import {
  assertCommandSupported,
} from "@modreef/hal";

const DEVICE_ID = "simulated-smart-strip";

export class SimulatedSmartStripDriver implements DeviceDriver {
  readonly id = "modreef.simulator.smart-strip";
  readonly name = "modREEF Simulated Smart Strip";

  private connected = false;
  private schedule: ScheduleEvent[] = [];

  private readonly descriptor: DeviceDescriptor = {
    id: DEVICE_ID,
    driverId: this.id,
    manufacturer: "modREEF",
    model: "Simulated 6-Outlet Strip",
    displayName: "Simulated Smart Strip",
    protocol: "simulator",
    firmwareVersion: "0.1.0",
    channels: Array.from({ length: 6 }, (_, index) => ({
      id: `outlet-${index + 1}`,
      name: `Outlet ${index + 1}`,
      channelNumber: index + 1,
      capabilities: [
        {
          kind: "relay",
          executionLocation: "device",
          internetRequired: false,
          reportsState: true,
          supportsAutoOff: true,
          minimumAutoOffSeconds: 1,
          maximumAutoOffSeconds: 86_400,
        },
        {
          kind: "power-monitoring",
          executionLocation: "device",
          internetRequired: false,
          reportsWatts: true,
          reportsVolts: true,
          reportsAmps: true,
          perChannel: true,
        },
        {
          kind: "energy-monitoring",
          executionLocation: "device",
          internetRequired: false,
          reportsKwh: true,
          perChannel: true,
        },
        {
          kind: "schedule",
          executionLocation: "device",
          internetRequired: false,
          runsWithoutApp: true,
          runsWithoutInternet: true,
          timingResolutionSeconds: 1,
          maximumEvents: 30,
          supportsWeekdays: true,
          survivesPowerLoss: true,
        },
        {
          kind: "countdown",
          executionLocation: "device",
          internetRequired: false,
          minimumSeconds: 1,
          maximumSeconds: 86_400,
          runsWithoutApp: true,
        },
      ],
    })),
  };

  private state: DeviceState = {
    deviceId: DEVICE_ID,
    connectionState: "disconnected",
    observedAt: new Date().toISOString(),
    channels: Object.fromEntries(
      Array.from({ length: 6 }, (_, index) => [
        `outlet-${index + 1}`,
        {
          relayOn: false,
          watts: 0,
          volts: 120,
          amps: 0,
          energyKwh: 0,
        },
      ]),
    ),
  };

  async discover(): Promise<DeviceDescriptor[]> {
    return [structuredClone(this.descriptor)];
  }

  async connect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    this.connected = true;
    this.refreshConnectionState();
  }

  async disconnect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    this.connected = false;
    this.refreshConnectionState();
  }

  async getDescriptor(
    deviceId: string,
  ): Promise<DeviceDescriptor> {
    this.assertDevice(deviceId);
    return structuredClone(this.descriptor);
  }

  async getState(deviceId: string): Promise<DeviceState> {
    this.assertDevice(deviceId);
    this.assertConnected();
    this.refreshConnectionState();
    return structuredClone(this.state);
  }

  async execute(
    command: DeviceCommand,
  ): Promise<CommandResult> {
    this.assertDevice(command.deviceId);
    this.assertConnected();
    assertCommandSupported(this.descriptor, command);

    if (command.type === "set-relay") {
      const channel = this.state.channels[command.channelId];

      if (!channel) {
        throw new Error(`Channel not found: ${command.channelId}`);
      }

      channel.relayOn = command.on;
      channel.watts = command.on ? 42 : 0;
      channel.amps = command.on ? 0.35 : 0;
    }

    if (command.type === "replace-schedule") {
      this.schedule = structuredClone(command.events);
    }

    if (command.type === "start-countdown") {
      const channel = this.state.channels[command.channelId];

      if (!channel) {
        throw new Error(`Channel not found: ${command.channelId}`);
      }

      channel.relayOn = true;
      channel.watts = 3;
      channel.amps = 0.025;
    }

    this.state.observedAt = new Date().toISOString();

    return {
      commandId: crypto.randomUUID(),
      deviceId: command.deviceId,
      accepted: true,
      completed: true,
      resultingState: structuredClone(this.state),
      completedAt: new Date().toISOString(),
    };
  }

  async health(): Promise<DriverHealth> {
    return {
      driverId: this.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: this.connected
        ? "Simulator connected"
        : "Simulator available",
    };
  }

  getInstalledSchedule(): ScheduleEvent[] {
    return structuredClone(this.schedule);
  }

  private assertDevice(deviceId: string): void {
    if (deviceId !== DEVICE_ID) {
      throw new Error(`Device not found: ${deviceId}`);
    }
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("Device is not connected");
    }
  }

  private refreshConnectionState(): void {
    this.state.connectionState = this.connected
      ? "connected"
      : "disconnected";

    this.state.observedAt = new Date().toISOString();
  }
}
