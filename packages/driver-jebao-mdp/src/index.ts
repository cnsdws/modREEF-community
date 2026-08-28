import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
} from "@modreef/hal";
import { assertCommandSupported } from "@modreef/hal";
import type { MdpTransport } from "./transport.js";

const channelId = "pump";

export class JebaoMdpDriver implements DeviceDriver {
  readonly name = "Jebao/Jecod MDP Pump Driver";
  private connected = false;
  private readonly descriptor: DeviceDescriptor;

  constructor(
    private readonly deviceId: string,
    private readonly transport: MdpTransport,
    readonly id = `modreef.jebao-mdp:${deviceId}`,
    model = "MDP-8500",
    displayName = "Return Pump",
  ) {
    this.descriptor = {
      id: deviceId,
      driverId: id,
      manufacturer: "Jebao / Jecod",
      model,
      displayName,
      protocol: "proprietary",
      channels: [{
        id: channelId,
        name: "Pump",
        capabilities: [
          {
            kind: "relay",
            executionLocation: "device",
            internetRequired: false,
            reportsState: true,
            supportsAutoOff: false,
          },
          {
            kind: "variable-speed",
            executionLocation: "device",
            internetRequired: false,
            minimumPercent: 30,
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
    await this.transport.connect();
    await this.transport.readState();
    this.connected = true;
  }
  async disconnect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    await this.transport.disconnect();
    this.connected = false;
  }
  async getDescriptor(deviceId: string): Promise<DeviceDescriptor> {
    this.assertDevice(deviceId);
    return structuredClone(this.descriptor);
  }
  async getState(deviceId: string): Promise<DeviceState> {
    this.assertReady(deviceId);
    return this.mapState(await this.transport.readState());
  }
  async execute(command: DeviceCommand): Promise<CommandResult> {
    this.assertReady(command.deviceId);
    assertCommandSupported(this.descriptor, command);
    const state = command.type === "set-relay"
      ? await this.transport.setPower(command.on)
      : command.type === "set-speed"
        ? await this.transport.setSpeed(command.percent)
        : undefined;
    if (!state) throw new Error(`Unsupported MDP command: ${command.type}`);
    return {
      commandId: crypto.randomUUID(),
      deviceId: this.deviceId,
      accepted: true,
      completed: true,
      resultingState: this.mapState(state),
      completedAt: new Date().toISOString(),
    };
  }
  async health(): Promise<DriverHealth> {
    return {
      driverId: this.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: this.connected ? "MDP pump connected" : "MDP driver available",
    };
  }
  private mapState(state: MdpPumpState): DeviceState {
    return {
      deviceId: this.deviceId,
      connectionState: "connected",
      observedAt: new Date().toISOString(),
      channels: {
        [channelId]: {
          relayOn: state.poweredOn,
          speedPercent: state.speedPercent,
        },
      },
    };
  }
  private assertDevice(deviceId: string): void {
    if (deviceId !== this.deviceId) throw new Error(`Device not found: ${deviceId}`);
  }
  private assertReady(deviceId: string): void {
    this.assertDevice(deviceId);
    if (!this.connected) throw new Error("MDP pump is not connected");
  }
}

import type { MdpPumpState } from "./protocol.js";
export * from "./protocol.js";
export * from "./transport.js";
export * from "./discovery.js";
export * from "./airlink.js";
