import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import bleno, { type ConnectionHandle } from "@stoprocent/bleno";
import {
  controllerIdentityCharacteristicUuid,
  controllerOnboardingServiceUuid,
  controllerProvisionCharacteristicUuid,
  controllerStatusCharacteristicUuid,
  openControllerWifiCredentials,
  type ControllerBleIdentity,
  type ControllerProvisioningStatus,
  type ControllerWifiProvisioningEnvelope,
} from "@modreef/onboarding";

import { provisionControllerWifi } from "./controller-wifi-provisioner.js";

const identityPath = process.env.MODREEF_FACTORY_IDENTITY ?? "/var/lib/modreef/factory-identity.json";
const provisionedMarker = process.env.MODREEF_WIFI_PROVISIONED_MARKER ?? "/var/lib/modreef/wifi-provisioned";
const { Characteristic, PrimaryService } = bleno;

interface FactoryIdentity {
  version: 1;
  hardwareSerial: string;
  setupId: string;
  claimSecret: string;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function readResult(value: Buffer, offset: number, callback: (result: number, data?: Buffer) => void): void {
  if (offset > value.length) callback(Characteristic.RESULT_INVALID_OFFSET);
  else callback(Characteristic.RESULT_SUCCESS, value.subarray(offset));
}

function validateFactoryIdentity(value: unknown): FactoryIdentity {
  const item = value as Partial<FactoryIdentity>;
  if (item.version !== 1 || typeof item.hardwareSerial !== "string" || !/^[a-f0-9]+$/.test(item.hardwareSerial) ||
      typeof item.setupId !== "string" || !/^[A-F0-9]{6}$/.test(item.setupId) ||
      typeof item.claimSecret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(item.claimSecret)) {
    throw new Error("Factory identity is invalid");
  }
  return item as FactoryIdentity;
}

export async function runControllerOnboardingService(): Promise<void> {
  const factory = validateFactoryIdentity(JSON.parse(await readFile(identityPath, "utf8")));
  const identity: ControllerBleIdentity = {
    version: 1,
    hardwareSerial: factory.hardwareSerial,
    setupId: factory.setupId,
    serverNonce: base64Url(randomBytes(24)),
  };
  let status: ControllerProvisioningStatus = { state: "ready", message: "Ready for secure Wi-Fi setup" };
  const pendingWrites = new Map<ConnectionHandle, Buffer>();
  let configuring = false;

  const identityCharacteristic = new Characteristic({
    uuid: controllerIdentityCharacteristicUuid,
    properties: ["read"],
    onReadRequest: (_handle, offset, callback) => readResult(Buffer.from(JSON.stringify(identity)), offset, callback),
  });
  const statusCharacteristic = new Characteristic({
    uuid: controllerStatusCharacteristicUuid,
    properties: ["read"],
    onReadRequest: (_handle, offset, callback) => readResult(Buffer.from(JSON.stringify(status)), offset, callback),
  });
  const provisionCharacteristic = new Characteristic({
    uuid: controllerProvisionCharacteristicUuid,
    properties: ["write"],
    onWriteRequest: (handle, data, offset, _withoutResponse, callback) => {
      if (offset !== 0 || configuring) {
        callback(Characteristic.RESULT_UNLIKELY_ERROR);
        return;
      }
      const combined = Buffer.concat([pendingWrites.get(handle) ?? Buffer.alloc(0), data]);
      if (combined.length > 4096) {
        pendingWrites.delete(handle);
        callback(Characteristic.RESULT_INVALID_ATTRIBUTE_LENGTH);
        return;
      }
      const delimiter = combined.indexOf(10);
      if (delimiter < 0) {
        pendingWrites.set(handle, combined);
        callback(Characteristic.RESULT_SUCCESS);
        return;
      }
      pendingWrites.delete(handle);
      callback(Characteristic.RESULT_SUCCESS);
      configuring = true;
      void (async () => {
        try {
          status = { state: "configuring", message: "Applying Wi-Fi settings" };
          const envelope = JSON.parse(combined.subarray(0, delimiter).toString("utf8")) as ControllerWifiProvisioningEnvelope;
          const credentials = openControllerWifiCredentials(identity, factory.claimSecret, envelope);
          status = { state: "joining", message: "Joining Wi-Fi" };
          await provisionControllerWifi(credentials);
          await writeFile(provisionedMarker, `${new Date().toISOString()}\n`, { mode: 0o600 });
          status = { state: "connected", message: "Connected to Wi-Fi" };
          setTimeout(() => {
            void bleno.stopAdvertisingAsync().finally(() => process.exit(0));
          }, 8_000);
        } catch {
          status = { state: "failed", message: "Could not join Wi-Fi. Check the network name and password." };
          configuring = false;
        }
      })();
    },
  });

  bleno.on("disconnect", (_address, handle) => pendingWrites.delete(handle));
  await bleno.waitForPoweredOnAsync(30_000);
  await bleno.setServicesAsync([new PrimaryService({
    uuid: controllerOnboardingServiceUuid,
    characteristics: [identityCharacteristic, provisionCharacteristic, statusCharacteristic],
  })]);
  await bleno.startAdvertisingAsync(`modREEF-${factory.setupId}`, [controllerOnboardingServiceUuid]);
  console.log(`Factory onboarding is ready for controller ${factory.setupId}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runControllerOnboardingService().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Factory onboarding failed");
    process.exitCode = 1;
  });
}
