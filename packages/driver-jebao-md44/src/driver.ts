import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
} from "@modreef/hal";
import { assertCommandSupported } from "@modreef/hal";
import type { TcpJebaoMd44Transport } from "./transport.js";
import {
  md44HeadIsRunning,
  type JebaoMd44RawStatus,
  type Md44DoseSlot,
} from "./protocol.js";

export class JebaoMd44Driver implements DeviceDriver {
  readonly name = "Jebao/Jecod MD-4.4 Doser Driver";
  private connected = false;
  private readonly heads = [false, false, false, false];
  private readonly descriptor: DeviceDescriptor;

  constructor(
    private readonly deviceId: string,
    private readonly transport: TcpJebaoMd44Transport,
    readonly id = `modreef.jebao-md44:${deviceId}`,
    displayName = "Jebao MD-4.4",
  ) {
    this.descriptor = {
      id: deviceId,
      driverId: id,
      manufacturer: "Jebao / Jecod",
      model: "MD-4.4",
      displayName,
      protocol: "proprietary",
      channels: Array.from({ length: 4 }, (_, index) => ({
        id: `head-${index + 1}`,
        name: `Doser ${index + 1}`,
        channelNumber: index + 1,
        capabilities: [{
          kind: "relay" as const,
          executionLocation: "optional-local-runtime" as const,
          internetRequired: false,
          reportsState: false,
          supportsAutoOff: false,
        }],
      })),
    };
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [structuredClone(this.descriptor)];
  }
  async connect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    await this.transport.connect();
    this.applyStatus(await this.transport.readRawStatus());
    this.connected = true;
  }
  async disconnect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    for (const [index, on] of this.heads.entries()) {
      if (on) await this.transport.setHeadPower(index + 1, false);
    }
    await this.transport.disconnect();
    this.heads.fill(false);
    this.connected = false;
  }
  async getDescriptor(deviceId: string): Promise<DeviceDescriptor> {
    this.assertDevice(deviceId);
    return structuredClone(this.descriptor);
  }
  async getState(deviceId: string): Promise<DeviceState> {
    this.assertReady(deviceId);
    this.applyStatus(await this.transport.readRawStatus());
    return this.state();
  }
  async execute(command: DeviceCommand): Promise<CommandResult> {
    this.assertReady(command.deviceId);
    assertCommandSupported(this.descriptor, command);
    if (command.type !== "set-relay") {
      throw new Error(`Unsupported MD-4.4 command: ${command.type}`);
    }
    const head = this.headNumber(command.channelId);
    await this.transport.setHeadPower(head, command.on);
    this.heads[head - 1] = command.on;
    return {
      commandId: crypto.randomUUID(),
      deviceId: this.deviceId,
      accepted: true,
      completed: true,
      resultingState: this.state(),
      completedAt: new Date().toISOString(),
    };
  }
  async health(): Promise<DriverHealth> {
    return {
      driverId: this.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: this.connected ? "MD-4.4 connected" : "MD-4.4 driver available",
    };
  }
  async setNativeSchedule(
    channelId: string,
    dayInterval: number,
    slots: readonly Md44DoseSlot[],
    enabled: boolean,
  ): Promise<void> {
    this.assertReady(this.deviceId);
    await this.transport.setHeadSchedule(
      this.headNumber(channelId), dayInterval, slots, enabled,
    );
  }
  private state(): DeviceState {
    return {
      deviceId: this.deviceId,
      connectionState: "connected",
      observedAt: new Date().toISOString(),
      channels: Object.fromEntries(this.heads.map((relayOn, index) => [
        `head-${index + 1}`,
        { relayOn },
      ])),
    };
  }
  private applyStatus(status: JebaoMd44RawStatus): void {
    for (let head = 1; head <= this.heads.length; head += 1) {
      this.heads[head - 1] = md44HeadIsRunning(status, head);
    }
  }
  private headNumber(channelId: string): number {
    const match = /^head-([1-4])$/.exec(channelId);
    if (!match?.[1]) throw new Error(`Unsupported MD-4.4 channel: ${channelId}`);
    return Number(match[1]);
  }
  private assertDevice(deviceId: string): void {
    if (deviceId !== this.deviceId) throw new Error(`Device not found: ${deviceId}`);
  }
  private assertReady(deviceId: string): void {
    this.assertDevice(deviceId);
    if (!this.connected) throw new Error("MD-4.4 is not connected");
  }
}
