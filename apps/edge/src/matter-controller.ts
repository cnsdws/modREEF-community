import { join } from "node:path";

import type {
  CommissioningController,
  NodeCommissioningOptions,
} from "@project-chip/matter.js";
import type { PairedNode } from "@project-chip/matter.js/device";
import type {
  CommandResult,
  DeviceCommand,
  DeviceDescriptor,
  DeviceDriver,
  DeviceState,
  DriverHealth,
} from "@modreef/hal";

import { dataDirectory } from "./equipment-runtime-paths.js";
import { MatterLifecycleCoordinator } from "./matter-lifecycle.js";

const matterDriverPrefix = "modreef.matter";

let controllerPromise: Promise<CommissioningController> | undefined;
const matterLifecycle = new MatterLifecycleCoordinator();

interface OnOffClientShape {
  getOnOffAttribute(remote?: boolean): Promise<boolean>;
  on(): Promise<void>;
  off(): Promise<void>;
}

interface ElectricalPowerClientShape {
  getActivePowerAttribute(remote?: boolean): Promise<number | bigint | null>;
}

interface ElectricalEnergyClientShape {
  getCumulativeEnergyImportedAttribute(
    remote?: boolean,
  ): Promise<{ energy: number | bigint } | null | undefined>;
}

interface MatterEndpointShape {
  getClusterClientById(clusterId: never): unknown;
}

function onOffClient(endpoint: ReturnType<PairedNode["getDeviceById"]>): OnOffClientShape | undefined {
  return endpoint?.getClusterClientById(6 as never) as unknown as OnOffClientShape | undefined;
}

function clusterClient<T>(
  endpoint: ReturnType<PairedNode["getDeviceById"]>,
  clusterId: number,
): T | undefined {
  return endpoint?.getClusterClientById(clusterId as never) as unknown as T | undefined;
}

export async function readMatterChannelState(
  endpoint: MatterEndpointShape,
): Promise<DeviceState["channels"][string]> {
  const client = onOffClient(endpoint as ReturnType<PairedNode["getDeviceById"]>);
  if (!client) throw new Error("Matter outlet does not expose an On/Off cluster");

  const powerClient = clusterClient<ElectricalPowerClientShape>(
    endpoint as ReturnType<PairedNode["getDeviceById"]>,
    0x0090,
  );
  const energyClient = clusterClient<ElectricalEnergyClientShape>(
    endpoint as ReturnType<PairedNode["getDeviceById"]>,
    0x0091,
  );
  const [relayOn, activePower, cumulativeEnergy] = await Promise.all([
    client.getOnOffAttribute(false),
    powerClient?.getActivePowerAttribute
      ? powerClient.getActivePowerAttribute(false)
      : undefined,
    energyClient?.getCumulativeEnergyImportedAttribute
      ? energyClient.getCumulativeEnergyImportedAttribute(false)
      : undefined,
  ]);
  const watts = matterMilliwattsToWatts(activePower);
  const energyKwh = matterMilliwattHoursToKilowattHours(cumulativeEnergy?.energy);

  return {
    relayOn,
    ...(watts === undefined ? {} : { watts }),
    ...(energyKwh === undefined ? {} : { energyKwh }),
  };
}

export function matterMilliwattsToWatts(
  value: number | bigint | null | undefined,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const watts = Number(value) / 1_000;
  return Number.isFinite(watts) ? watts : undefined;
}

export function matterMilliwattHoursToKilowattHours(
  value: number | bigint | null | undefined,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const kilowattHours = Number(value) / 1_000_000;
  return Number.isFinite(kilowattHours) ? kilowattHours : undefined;
}

function controller(): Promise<CommissioningController> {
  if (!controllerPromise) {
    controllerPromise = (async () => {
      await import("@matter/nodejs");
      await import("@matter/nodejs-ble");
      const { Environment } = await import("@matter/main");
      const { CommissioningController } = await import("@project-chip/matter.js");
      const environment = Environment.default;
      environment.vars.set("storage.path", join(dataDirectory, "matter"));
      environment.vars.set("runtime.signals", false);
      environment.vars.set("ble.enable", true);

      const instance = new CommissioningController({
        environment: { environment, id: "modreef-edge" },
        adminFabricLabel: "modREEF Edge",
        autoConnect: false,
        autoSubscribe: true,
      });
      await instance.start();
      return instance;
    })();
  }
  return controllerPromise;
}

export function isOperationalHandoffFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /operative-connection-failed|operational.*reconnect|peer-unreachable/i.test(message);
}

export function isRecoverableMatterPairingFailure(error: unknown): boolean {
  if (isOperationalHandoffFailure(error)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to connect to peripheral|could not connect to device|peer-communication|ble.*unreachable|discovery-aggregate|no device could be commissioned/i.test(message);
}

export function isTapoP316mMatterDevice(
  vendorId: unknown,
  productId: unknown,
): boolean {
  return Number(vendorId) === 5010 && Number(productId) === 274;
}

async function configureMatterBleCompatibility(
  pairingCode: string,
  compatibilityHint?: "tapo-p316m",
): Promise<boolean> {
  const { ManualPairingCodeCodec, QrPairingCodeCodec } = await import("@matter/main/types");
  const normalizedCode = pairingCode.replace(/\s+/g, "");
  const decoded = normalizedCode.startsWith("MT:")
    ? QrPairingCodeCodec.decode(normalizedCode)[0]
    : ManualPairingCodeCodec.decode(normalizedCode);
  if (!decoded) throw new Error("The Matter QR code does not contain a commissioning payload");

  const inferredTapoP316m = "vendorId" in decoded
    && "productId" in decoded
    && isTapoP316mMatterDevice(decoded.vendorId, decoded.productId);
  if (compatibilityHint !== "tapo-p316m" && !inferredTapoP316m) return false;

  const discriminator = "discriminator" in decoded
    ? decoded.discriminator
    : decoded.shortDiscriminator;
  process.env.MODREEF_MATTER_BLE_ADDRESS = "*";
  process.env.MODREEF_MATTER_DISCRIMINATOR = String(discriminator);
  process.env.MODREEF_MATTER_VENDOR_ID = String("vendorId" in decoded ? decoded.vendorId : 0);
  process.env.MODREEF_MATTER_PRODUCT_ID = String("productId" in decoded ? decoded.productId : 0);
  return true;
}

function clearMatterBleCompatibility(): void {
  delete process.env.MODREEF_MATTER_BLE_ADDRESS;
  delete process.env.MODREEF_MATTER_DISCRIMINATOR;
  delete process.env.MODREEF_MATTER_VENDOR_ID;
  delete process.env.MODREEF_MATTER_PRODUCT_ID;
}

function runtimeDeviceId(nodeId: bigint): string {
  return `matter-${nodeId.toString()}`;
}

export function matterDriverId(deviceId: string): string {
  return `${matterDriverPrefix}:${deviceId}`;
}

function nodeIdFromDeviceId(deviceId: string): bigint {
  const raw = deviceId.startsWith("matter-")
    ? deviceId.slice("matter-".length)
    : deviceId;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid Matter device id: ${deviceId}`);
  return BigInt(raw);
}

async function connectedNode(deviceId: string): Promise<PairedNode> {
  const instance = await controller();
  const node = await instance.getNode(nodeIdFromDeviceId(deviceId) as never);
  if (!node.isConnected) {
    node.connect({ autoSubscribe: true });
    const deadline = Date.now() + 15_000;
    while (!node.isConnected) {
      if (Date.now() >= deadline) {
        throw new Error(`Matter node ${deviceId} did not connect within 15 seconds`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return node;
}

function controllableEndpoints(node: PairedNode) {
  return node.getDevices()
    .filter((endpoint) => endpoint.number !== undefined && endpoint.getClusterClientById(6 as never) !== undefined)
    .sort((left, right) => Number(left.number) - Number(right.number));
}

function basicString(
  node: PairedNode,
  key: "vendorName" | "productName" | "nodeLabel" | "softwareVersionString" | "serialNumber",
): string | undefined {
  const value = node.basicInformation?.[key];
  return typeof value === "string" ? value : undefined;
}

export interface CommissionedMatterDevice {
  deviceId: string;
  driverId: string;
  manufacturer: string;
  model: string;
  endpointIds: number[];
}

export type MatterCommissioningStage =
  | "preparing"
  | "commissioning"
  | "recovering"
  | "verifying";

async function commissionMatterDeviceOnce(
  pairingCode: string,
  wifiNetwork?: { ssid: string; password: string },
  onProgress?: (stage: MatterCommissioningStage) => void,
): Promise<CommissionedMatterDevice> {
  const { GeneralCommissioning } = await import("@matter/main/clusters");
  const { ManualPairingCodeCodec, QrPairingCodeCodec } = await import("@matter/main/types");
  const normalizedCode = pairingCode.replace(/\s+/g, "");
  const decoded = normalizedCode.startsWith("MT:")
    ? QrPairingCodeCodec.decode(normalizedCode)[0]
    : ManualPairingCodeCodec.decode(normalizedCode);
  if (!decoded) throw new Error("The Matter QR code does not contain a commissioning payload");
  const options: NodeCommissioningOptions = {
    commissioning: {
      regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
      regulatoryCountryCode: "US",
      ...(wifiNetwork ? {
        wifiNetwork: {
          wifiSsid: wifiNetwork.ssid,
          wifiCredentials: wifiNetwork.password,
        },
      } : {}),
    },
    discovery: {
      identifierData: "discriminator" in decoded
        ? { longDiscriminator: decoded.discriminator }
        : { shortDiscriminator: decoded.shortDiscriminator },
      discoveryCapabilities: { ble: Boolean(wifiNetwork) },
    },
    passcode: decoded.passcode,
  };

  const instance = await controller();
  onProgress?.("commissioning");
  const nodeId = await instance.commissionNode(options);
  const deviceId = runtimeDeviceId(nodeId);
  onProgress?.("verifying");
  const node = await connectedNode(deviceId);
  const endpoints = controllableEndpoints(node);
  if (endpoints.length === 0) {
    await instance.removeNode(nodeId);
    throw new Error("Matter device does not expose any controllable outlets");
  }

  return {
    deviceId,
    driverId: matterDriverId(deviceId),
    manufacturer: basicString(node, "vendorName") ?? "Matter",
    model: basicString(node, "productName") ?? "Matter Device",
    endpointIds: endpoints.map((endpoint) => Number(endpoint.number)),
  };
}

export async function commissionMatterDevice(
  pairingCode: string,
  wifiNetwork?: { ssid: string; password: string },
  compatibilityHint?: "tapo-p316m",
  onProgress?: (stage: MatterCommissioningStage) => void,
): Promise<CommissionedMatterDevice> {
  // Configure the compatibility scanner before the controller is started or
  // refreshed. Some Tapo P316M firmware advertises its vendor setup service
  // (0x8641), but omits the standard Matter commissioning service (0xFFF6).
  // The QR payload identifies the model, so generic QR pairing remains usable.
  const compatibilityConfigured = await configureMatterBleCompatibility(
    pairingCode,
    compatibilityHint,
  );
  try {
    return await matterLifecycle.commission({
      attempt: () => commissionMatterDeviceOnce(
        pairingCode,
        wifiNetwork,
        onProgress,
      ),
      isRecoverable: isRecoverableMatterPairingFailure,
      onRecovering: () => {
        onProgress?.("recovering");
        console.warn(
          "Matter operational handoff failed; retrying once with a fresh controller session",
        );
      },
    });
  } finally {
    if (compatibilityConfigured) clearMatterBleCompatibility();
  }
}

export async function removeMatterDevice(deviceId: string): Promise<void> {
  const instance = await controller();
  const nodeId = nodeIdFromDeviceId(deviceId) as never;
  await matterLifecycle.remove({
    label: deviceId,
    isPresent: () => instance.isNodeCommissioned(nodeId),
    remove: () => instance.removeNode(nodeId),
  });
}

export class MatterOutletDriver implements DeviceDriver {
  readonly id: string;
  readonly name = "Matter Outlet";

  constructor(private readonly deviceId: string) {
    this.id = matterDriverId(deviceId);
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [await this.getDescriptor(this.deviceId)];
  }

  async connect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    await connectedNode(deviceId);
  }

  async disconnect(deviceId: string): Promise<void> {
    this.assertDevice(deviceId);
    const instance = await controller();
    const node = await instance.getNode(nodeIdFromDeviceId(deviceId) as never);
    await node.disconnect();
  }

  async getDescriptor(deviceId: string): Promise<DeviceDescriptor> {
    this.assertDevice(deviceId);
    const node = await connectedNode(deviceId);
    const vendorName = basicString(node, "vendorName");
    const productName = basicString(node, "productName");
    const nodeLabel = basicString(node, "nodeLabel");
    const firmwareVersion = basicString(node, "softwareVersionString");
    const serialNumber = basicString(node, "serialNumber");
    return {
      id: deviceId,
      driverId: this.id,
      manufacturer: vendorName ?? "Matter",
      model: productName ?? "Matter Device",
      displayName: nodeLabel || productName || "Matter Device",
      protocol: "matter",
      ...(firmwareVersion ? { firmwareVersion } : {}),
      ...(serialNumber ? { serialNumber } : {}),
      channels: controllableEndpoints(node).map((endpoint, index) => ({
        id: `endpoint-${Number(endpoint.number)}`,
        name: `Outlet ${index + 1}`,
        channelNumber: index + 1,
        capabilities: [{
          kind: "relay" as const,
          executionLocation: "optional-local-runtime" as const,
          internetRequired: false,
          reportsState: true,
          supportsAutoOff: false,
        },
        ...(endpoint.getClusterClientById(0x0090 as never) ? [{
          kind: "power-monitoring" as const,
          executionLocation: "device" as const,
          internetRequired: false,
          reportsWatts: true,
          reportsVolts: false,
          reportsAmps: false,
          perChannel: true,
        }] : []),
        ...(endpoint.getClusterClientById(0x0091 as never) ? [{
          kind: "energy-monitoring" as const,
          executionLocation: "device" as const,
          internetRequired: false,
          reportsKwh: true,
          perChannel: true,
        }] : [])],
      })),
    };
  }

  async getState(deviceId: string): Promise<DeviceState> {
    this.assertDevice(deviceId);
    const node = await connectedNode(deviceId);
    const channelEntries = await Promise.all(
      controllableEndpoints(node).map(async (endpoint) => [
        `endpoint-${Number(endpoint.number)}`,
        await readMatterChannelState(endpoint),
      ] as const),
    );
    const channels: DeviceState["channels"] = Object.fromEntries(channelEntries);
    return {
      deviceId,
      connectionState: node.isConnected ? "connected" : "disconnected",
      observedAt: new Date().toISOString(),
      channels,
    };
  }

  async execute(command: DeviceCommand): Promise<CommandResult> {
    this.assertDevice(command.deviceId);
    if (command.type !== "set-relay") {
      return {
        commandId: crypto.randomUUID(),
        deviceId: command.deviceId,
        accepted: false,
        completed: true,
        message: `Matter outlet does not support ${command.type}`,
        completedAt: new Date().toISOString(),
      };
    }
    const endpointNumber = Number(command.channelId.replace(/^endpoint-/, ""));
    const node = await connectedNode(command.deviceId);
    const client = onOffClient(node.getDeviceById(endpointNumber));
    if (!client) throw new Error(`Matter outlet not found: ${command.channelId}`);
    if (command.on) await client.on();
    else await client.off();
    const relayOn = await client.getOnOffAttribute(true);
    return {
      commandId: crypto.randomUUID(),
      deviceId: command.deviceId,
      accepted: true,
      completed: true,
      resultingState: {
        deviceId: command.deviceId,
        connectionState: node.isConnected ? "connected" : "disconnected",
        observedAt: new Date().toISOString(),
        channels: {
          [command.channelId]: { relayOn },
        },
      },
      completedAt: new Date().toISOString(),
    };
  }

  async health(): Promise<DriverHealth> {
    try {
      const node = await connectedNode(this.deviceId);
      return {
        driverId: this.id,
        healthy: node.isConnected,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        driverId: this.id,
        healthy: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private assertDevice(deviceId: string): void {
    if (deviceId !== this.deviceId) throw new Error(`Unknown Matter device: ${deviceId}`);
  }
}
