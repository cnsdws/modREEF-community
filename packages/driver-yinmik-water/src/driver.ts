import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
} from "@modreef/hal";
import type { WaterMeasurement } from "@modreef/digital-twin";

import { yinmikWaterMeasurements } from "./water.js";

export type TuyaProtocolVersion = "3.3" | "3.4" | "3.5";

export interface YinmikWaterCredentials {
  deviceId: string;
  networkAddress: string;
  localKey: string;
  productId: string;
  protocolVersion?: TuyaProtocolVersion;
}

export interface YinmikWaterRegistration {
  deviceId: string;
  displayName: string;
  credentials: YinmikWaterCredentials;
  driverId?: string;
}

export interface YinmikWaterTransport {
  readStatus(): Promise<Record<string, unknown>>;
}

export interface YinmikWaterDriverServices {
  createTransport(credentials: YinmikWaterCredentials): YinmikWaterTransport;
  resolveNetworkAddress?(deviceId: string): Promise<string>;
  persistCredentials?(credentials: YinmikWaterCredentials): void;
}

export class YinmikWaterDriver implements DeviceDriver {
  readonly id: string;
  readonly name = "YINMIK Water 7-in-1 Driver";

  private credentials: YinmikWaterCredentials;
  private transport: YinmikWaterTransport;
  private connected = false;
  private latestMeasurements: WaterMeasurement[] = [];
  private readonly descriptor: DeviceDescriptor;

  constructor(
    readonly registration: YinmikWaterRegistration,
    private readonly services: YinmikWaterDriverServices,
  ) {
    this.id = registration.driverId ?? `modreef.yinmik-water:${registration.deviceId}`;
    this.credentials = { ...registration.credentials };
    this.transport = services.createTransport(this.credentials);
    this.descriptor = {
      id: registration.deviceId,
      driverId: this.id,
      manufacturer: "YINMIK",
      model: "Water 7-in-1",
      displayName: registration.displayName,
      protocol: "tuya-wifi",
      channels: [{
        id: "water-quality",
        name: "Water Quality",
        capabilities: [
          sensorCapability("temperature", "°F"),
          sensorCapability("ph", ""),
          sensorCapability("orp", "mV"),
          sensorCapability("salinity", "ppt"),
        ],
      }],
    };
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [structuredClone(this.descriptor)];
  }

  async connect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    const dps = await this.readDpsWithRecovery();
    this.updateMeasurements("unassigned", dps);
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
    const dps = await this.readDpsWithRecovery();
    this.updateMeasurements("unassigned", dps);
    this.connected = true;
    return this.state();
  }

  async readMeasurements(
    aquariumId: string,
    measuredAt = new Date().toISOString(),
  ): Promise<WaterMeasurement[]> {
    const dps = await this.readDpsWithRecovery();
    this.latestMeasurements = yinmikWaterMeasurements(
      aquariumId,
      this.registration.deviceId,
      dps,
      measuredAt,
    );
    this.connected = true;
    return structuredClone(this.latestMeasurements);
  }

  async execute(command: DeviceCommand): Promise<CommandResult> {
    this.assertDevice(command.deviceId);
    throw new Error(`YINMIK water meter does not support commands: ${command.type}`);
  }

  async health(): Promise<DriverHealth> {
    return {
      driverId: this.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      message: this.connected ? "Water meter connected" : "Water meter driver available",
    };
  }

  private async readDpsWithRecovery(): Promise<Record<string, unknown>> {
    try {
      return await this.transport.readStatus();
    } catch (initialError) {
      let networkAddress = this.credentials.networkAddress;
      if (this.services.resolveNetworkAddress) {
        try {
          networkAddress = await this.services.resolveNetworkAddress(this.registration.deviceId);
        } catch {
          // A cached private address may still be usable when discovery is unavailable.
        }
      }
      const versions: TuyaProtocolVersion[] = this.credentials.protocolVersion
        ? [this.credentials.protocolVersion, "3.4", "3.5", "3.3"]
        : ["3.4", "3.5", "3.3"];
      for (const protocolVersion of [...new Set(versions)]) {
        const credentials = { ...this.credentials, networkAddress, protocolVersion };
        const candidate = this.services.createTransport(credentials);
        try {
          const dps = await candidate.readStatus();
          this.credentials = credentials;
          this.transport = candidate;
          this.services.persistCredentials?.(credentials);
          return dps;
        } catch {
          // Continue through the bounded protocol compatibility list.
        }
      }
      this.connected = false;
      throw initialError;
    }
  }

  private updateMeasurements(aquariumId: string, dps: Record<string, unknown>): void {
    this.latestMeasurements = yinmikWaterMeasurements(
      aquariumId,
      this.registration.deviceId,
      dps,
    );
  }

  private state(): DeviceState {
    return {
      deviceId: this.registration.deviceId,
      connectionState: this.connected ? "connected" : "disconnected",
      observedAt: new Date().toISOString(),
      channels: {
        "water-quality": {
          measurements: Object.fromEntries(this.latestMeasurements.map((measurement) => [
            measurement.parameter,
            { value: measurement.value, unit: measurement.unit },
          ])),
        },
      },
    };
  }

  private assertDevice(deviceId: string): void {
    if (deviceId !== this.registration.deviceId) {
      throw new Error(`Device not found: ${deviceId}`);
    }
  }
}

function sensorCapability(
  kind: "temperature" | "ph" | "orp" | "salinity",
  unit: string,
) {
  return {
    kind,
    unit,
    executionLocation: "optional-local-runtime" as const,
    internetRequired: false,
  };
}
