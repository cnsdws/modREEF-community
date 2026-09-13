import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
} from "@modreef/hal";
import { assertCommandSupported } from "@modreef/hal";

import { DmpBleController, type DmpMode } from "./ble.js";

export interface DmpController {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setPower(on: boolean): Promise<void>;
  setMode(mode: DmpMode, speedPercent: number, pulseFrequency?: number): Promise<void>;
}

export type DmpControllerFactory = (bluetoothAddress: string) => DmpController;

export interface JebaoDmpRegistration {
  deviceId: string;
  displayName: string;
  advertisedName: string;
  bluetoothAddress: string;
  driverId?: string;
}

export class JebaoDmpDriver implements DeviceDriver {
  readonly id: string;
  readonly name = "Jebao/Jecod DMP Wavemaker Driver";

  private controller: DmpController | undefined;
  private connected = false;
  private relayOn = false;
  private speedPercent = 30;
  private mode: DmpMode = "M3";
  private pulseFrequency = 100;
  private readonly descriptor: DeviceDescriptor;

  constructor(
    readonly registration: JebaoDmpRegistration,
    private readonly createController: DmpControllerFactory =
      (bluetoothAddress) => new DmpBleController(bluetoothAddress),
  ) {
    this.id = registration.driverId ?? `modreef.jebao-dmp-ble:${registration.deviceId}`;
    this.descriptor = {
      id: registration.deviceId,
      driverId: this.id,
      manufacturer: "Jebao / Jecod",
      model: "DMP-40",
      displayName: registration.displayName,
      protocol: "bluetooth",
      channels: [{
        id: "pump",
        name: "Wavemaker",
        capabilities: [
          {
            kind: "relay",
            executionLocation: "optional-local-runtime",
            internetRequired: false,
            reportsState: false,
            supportsAutoOff: false,
          },
          {
            kind: "variable-speed",
            executionLocation: "optional-local-runtime",
            internetRequired: false,
            minimumPercent: 0,
            maximumPercent: 100,
            stepPercent: 1,
          },
        ],
      }],
    };
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [structuredClone(this.descriptor)];
  }

  async connect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    if (this.connected) return;
    this.controller = this.createController(this.registration.bluetoothAddress);
    try {
      await this.controller.connect();
      this.connected = true;
    } catch (error) {
      await this.controller.disconnect();
      this.controller = undefined;
      throw error;
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    const controller = this.controller;
    this.controller = undefined;
    this.connected = false;
    if (controller) await controller.disconnect();
  }

  async getDescriptor(deviceId: string): Promise<DeviceDescriptor> {
    this.assertDevice(deviceId);
    return structuredClone(this.descriptor);
  }

  async getState(deviceId: string): Promise<DeviceState> {
    this.assertDevice(deviceId);
    return this.state();
  }

  async execute(command: DeviceCommand): Promise<CommandResult> {
    this.assertReady(command.deviceId);
    assertCommandSupported(this.descriptor, command);
    if (command.type === "set-relay") {
      await this.controller!.setPower(command.on);
      this.relayOn = command.on;
    } else if (command.type === "set-speed") {
      await this.setMode(this.mode, command.percent, this.pulseFrequency);
    } else {
      throw new Error(`Unsupported DMP command: ${command.type}`);
    }
    return this.result();
  }

  async setPower(on: boolean): Promise<CommandResult> {
    return this.execute({
      type: "set-relay",
      deviceId: this.registration.deviceId,
      channelId: "pump",
      on,
    });
  }

  async setMode(
    mode: DmpMode,
    speedPercent: number,
    pulseFrequency = 100,
  ): Promise<CommandResult> {
    this.assertReady(this.registration.deviceId);
    await this.controller!.setMode(mode, speedPercent, pulseFrequency);
    this.mode = mode;
    this.speedPercent = Math.max(0, Math.min(100, Math.round(speedPercent)));
    this.pulseFrequency = Math.max(5, Math.min(100, Math.round(pulseFrequency)));
    return this.result();
  }

  async health(): Promise<DriverHealth> {
    return {
      driverId: this.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: this.connected ? "DMP wavemaker connected" : "DMP wavemaker driver available",
    };
  }

  private state(): DeviceState {
    return {
      deviceId: this.registration.deviceId,
      connectionState: this.connected ? "connected" : "disconnected",
      observedAt: new Date().toISOString(),
      channels: {
        pump: {
          relayOn: this.relayOn,
          speedPercent: this.speedPercent,
        },
      },
    };
  }

  private async result(): Promise<CommandResult> {
    return {
      commandId: crypto.randomUUID(),
      deviceId: this.registration.deviceId,
      accepted: true,
      completed: true,
      resultingState: this.state(),
      completedAt: new Date().toISOString(),
    };
  }

  private assertDevice(deviceId: string): void {
    if (deviceId !== this.registration.deviceId) {
      throw new Error(`Device not found: ${deviceId}`);
    }
  }

  private assertReady(deviceId: string): void {
    this.assertDevice(deviceId);
    if (!this.connected || !this.controller) throw new Error("DMP wavemaker is not connected");
  }
}
