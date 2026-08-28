import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
} from "@modreef/hal";
import { assertCommandSupported } from "@modreef/hal";
import { createGHomeWp12Descriptor } from "./descriptor.js";
import { mapGHomeWp12State } from "./state.js";
import type { GHomeWp12Transport } from "./transport.js";

const minimumCountdownSeconds = 1;
const maximumCountdownSeconds = 86_400;

export class GHomeWp12Driver implements DeviceDriver {
  readonly id: string;
  readonly name = "GHome WP12 Driver";

  private readonly descriptor: DeviceDescriptor;
  private connected = false;

  constructor(
    private readonly deviceId: string,
    private readonly transport: GHomeWp12Transport,
    driverId = "modreef.ghome.wp12",
  ) {
    this.id = driverId;
    this.descriptor = createGHomeWp12Descriptor(deviceId);
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [structuredClone(this.descriptor)];
  }

  async connect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    await this.transport.readStatus();
    this.connected = true;
  }

  async disconnect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    this.connected = false;
  }

  async getDescriptor(deviceId: string): Promise<DeviceDescriptor> {
    this.assertDevice(deviceId);
    return structuredClone(this.descriptor);
  }

  async getState(deviceId: string): Promise<DeviceState> {
    this.assertDevice(deviceId);
    this.assertConnected();

    return mapGHomeWp12State(
      deviceId,
      await this.transport.readStatus(),
    );
  }

  async execute(command: DeviceCommand): Promise<CommandResult> {
    this.assertDevice(command.deviceId);
    this.assertConnected();
    assertCommandSupported(this.descriptor, command);

    if (command.type === "set-relay") {
      const dps = this.channelToDps(command.channelId);
      await this.transport.setValue(dps, command.on);

      return this.completedResult(command.deviceId);
    }

    if (
      command.type === "start-countdown" &&
      command.finalRelayState === false
    ) {
      this.assertCountdown(command.seconds);

      const relayDps = this.channelToDps(command.channelId);
      const countdownDps = relayDps + 8;

      await this.transport.setValues({
        [relayDps]: true,
        [countdownDps]: command.seconds,
      });

      return this.completedResult(command.deviceId);
    }

    throw new Error(`Unsupported command: ${command.type}`);
  }

  async turnOnWithCountdown(
    deviceId: string,
    channelId: string,
    countdownSeconds: number,
  ): Promise<CommandResult> {
    return this.execute({
      type: "start-countdown",
      deviceId,
      channelId,
      seconds: countdownSeconds,
      finalRelayState: false,
    });
  }

  async health(): Promise<DriverHealth> {
    return {
      driverId: this.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: this.connected
        ? "GHome WP12 connected"
        : "GHome WP12 driver available",
    };
  }

  private async completedResult(
    deviceId: string,
  ): Promise<CommandResult> {
    const resultingState = await this.getState(deviceId);

    return {
      commandId: crypto.randomUUID(),
      deviceId,
      accepted: true,
      completed: true,
      resultingState,
      completedAt: new Date().toISOString(),
    };
  }

  private channelToDps(channelId: string): number {
    if (channelId === "usb") {
      return 7;
    }

    const match = /^outlet-([1-6])$/.exec(channelId);

    if (!match?.[1]) {
      throw new Error(`Unsupported relay channel: ${channelId}`);
    }

    return Number(match[1]);
  }

  private assertCountdown(countdownSeconds: number): void {
    if (
      !Number.isInteger(countdownSeconds) ||
      countdownSeconds < minimumCountdownSeconds ||
      countdownSeconds > maximumCountdownSeconds
    ) {
      throw new Error(
        "Countdown must be an integer between 1 and 86400 seconds",
      );
    }
  }

  private assertDevice(deviceId: string): void {
    if (deviceId !== this.deviceId) {
      throw new Error(`Device not found: ${deviceId}`);
    }
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error("Device is not connected");
    }
  }
}

export { PythonGHomeWp12Transport } from "./python-transport.js";
