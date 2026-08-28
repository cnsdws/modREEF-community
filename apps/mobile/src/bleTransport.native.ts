import type {
  OnboardingCandidate,
  OnboardingTransport,
  WifiCredentials,
} from "@modreef/onboarding";
import BleManager, {
  type Peripheral,
} from "react-native-ble-manager";

import TuyaBridgeModule from "../modules/tuya-bridge/src/TuyaBridgeModule";
import type { TuyaHomeDevice } from "../modules/tuya-bridge/src/TuyaBridgeModule";
import {
  discoverMd44Dosers,
  registerOnboardedEquipment,
  registerMd44Doser,
  storeGHomeWp12Credentials,
  storeYinmikWaterCredentials,
} from "./edgeClient";
import {
  buildJebaoBleWifiFrame,
  chunkJebaoBleWifiFrame,
  isJebaoBleAdvertisement,
  isJebaoDmpBleAdvertisement,
  jebaoBleCharacteristicUuid,
  jebaoDmpBleManufacturerMarker,
  jebaoBleManufacturerMarker,
  jebaoBleServiceUuid,
} from "./jebaoBleProvisioning";
import { deduplicateTuyaCandidates } from "./tuyaCandidateIdentity";
import {
  yinmikWaterProductId,
  tuyaDiscoveredDeviceMarker,
  tuyaOwnedDeviceMarker,
  tuyaWaterDeviceMarker,
} from "./tuyaIdentityConstants";

export {
  yinmikWaterProductId,
  tuyaDiscoveredDeviceMarker,
  tuyaOwnedDeviceMarker,
  tuyaWaterDeviceMarker,
} from "./tuyaIdentityConstants";

export type DeviceDiscoveryKind = "bluetooth" | "wifi";
function isWaterQualityDevice(device: TuyaHomeDevice): boolean {
  if (device.productId === yinmikWaterProductId) return true;
  const terms = device.capabilities.map((value) => value.toLowerCase());
  const waterSignals = [
    ["temp", "temperature"],
    ["ph", "ph_value"],
    ["conduct", "salinity", "tds", "ec_value"],
    ["orp"],
  ];
  return waterSignals.filter((alternatives) =>
    alternatives.some((value) => terms.some((term) => term.includes(value)))
  ).length >= 3;
}

export async function removeOwnedTuyaDevice(deviceId: string): Promise<void> {
  await TuyaBridgeModule.removeDevice(deviceId);
}

function bytesFromBase64(value: string | undefined): number[] {
  if (!value) return [];
  try {
    return [...globalThis.atob(value)].map((character) => character.charCodeAt(0));
  } catch {
    return [];
  }
}

function rawTuyaCandidate(peripheral: Peripheral): OnboardingCandidate | undefined {
  const services = peripheral.advertising.serviceUUIDs ?? [];
  if (!services.some((uuid) => uuid.replaceAll("-", "").toUpperCase() === "FD50")) {
    return undefined;
  }
  const serviceEntry = Object.entries(peripheral.advertising.serviceData ?? {})
    .find(([uuid]) => uuid.replaceAll("-", "").toUpperCase() === "FD50");
  const serviceBytes = bytesFromBase64(serviceEntry?.[1].data);
  const productId = String.fromCharCode(...serviceBytes.slice(4))
    .replace(/[^\x20-\x7e].*$/, "")
    .trim();
  const manufacturerBytes = bytesFromBase64(
    peripheral.advertising.manufacturerRawData?.data,
  );
  const uuidBytes = manufacturerBytes.length >= 16
    ? manufacturerBytes.slice(-16)
    : [];
  const tuyaUuid = uuidBytes
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (!/^[a-zA-Z0-9]{8,64}$/.test(productId) || tuyaUuid.length !== 32) {
    return undefined;
  }
  return {
    id: tuyaUuid,
    transport: "bluetooth-le",
    displayName: "Nearby device",
    signalStrength: peripheral.rssi,
    manufacturerData: productId,
    serviceUuids: [tuyaDiscoveredDeviceMarker, "FD50"],
  };
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

export interface BluetoothGattInspection {
  services: string[];
  characteristics: Array<{
    service: string;
    characteristic: string;
    properties: string[];
  }>;
}

export async function inspectJebaoDmpDevice(
  candidate: OnboardingCandidate,
): Promise<BluetoothGattInspection> {
  const peripheralId = candidate.id.replace(/^jebao-dmp-ble:/, "");
  if (peripheralId === candidate.id) {
    throw new Error("This Bluetooth result is not a Jebao wavemaker.");
  }

  await ensureBleManagerStarted();
  console.info("[Jebao DMP BLE] connecting", peripheralId);
  try {
    await withBleTimeout(
      BleManager.connect(peripheralId),
      12_000,
      "Could not connect to the Jebao wavemaker over Bluetooth",
    );
    console.info("[Jebao DMP BLE] connected");
    const peripheral = await withBleTimeout(
      BleManager.retrieveServices(peripheralId),
      10_000,
      "The Jebao wavemaker Bluetooth services could not be read",
    );
    const inspection: BluetoothGattInspection = {
      services: (peripheral.services ?? []).map((service) => service.uuid),
      characteristics: (peripheral.characteristics ?? []).map((item) => ({
        service: item.service,
        characteristic: item.characteristic,
        properties: Object.keys(item.properties).filter(
          (property) => Boolean(item.properties[property as keyof typeof item.properties]),
        ),
      })),
    };
    console.info("[Jebao DMP BLE] GATT", JSON.stringify(inspection));
    return inspection;
  } finally {
    await BleManager.disconnect(peripheralId, true).catch(() => undefined);
  }
}

class NativeBleTransport implements OnboardingTransport {
  readonly kind = "bluetooth-le" as const;
  private tuyaHomePromise: Promise<{ id: string }> | undefined;
  private readonly ownedTuyaDevices = new Map<string, TuyaHomeDevice>();

  constructor(private readonly discoveryKind: DeviceDiscoveryKind) {}

  private async ensureTuyaHome(): Promise<{ id: string }> {
    if (!this.tuyaHomePromise) {
      this.tuyaHomePromise = (async () => {
        const status = TuyaBridgeModule.getStatus();
        if (!status.loggedIn) {
          await TuyaBridgeModule.registerAnonymous("1");
        }

        const homes = await TuyaBridgeModule.getHomes();
        return homes[0] ?? TuyaBridgeModule.createHome("modREEF Aquarium");
      })().catch((error) => {
        this.tuyaHomePromise = undefined;
        throw error;
      });
    }

    return this.tuyaHomePromise;
  }

  async scan(
    signal?: AbortSignal,
  ): Promise<OnboardingCandidate[]> {
    if (signal?.aborted) {
      throw new Error("Bluetooth scan cancelled");
    }

    if (this.discoveryKind === "bluetooth") {
      const rawCandidates = await scanMatter(signal, true);
      const rawTuya = rawCandidates.filter((candidate) =>
        candidate.serviceUuids.includes(tuyaDiscoveredDeviceMarker)
      );
      try {
        // FD50 tells us a Tuya commissioning device is nearby, but the raw
        // advertisement is not an authoritative device-type record. Resolve
        // its product ID and capabilities before choosing the user-facing
        // category.
        const identifiedTuya = await this.scanTuya(signal);
        if (identifiedTuya.length > 0) return identifiedTuya;
      } catch (error) {
        if (rawTuya.length === 0) throw error;
        console.info(
          "[modREEF Tuya identity] SDK enrichment unavailable; using raw advertisements",
          error instanceof Error ? error.message : String(error),
        );
      }
      return rawTuya;
    }

    const candidates: OnboardingCandidate[] = [];
    const failures: unknown[] = [];

    // CoreBluetooth only performs one dependable commissioning scan at a
    // time. Scan the open BLE families first so Jebao setup advertisements
    // are surfaced immediately, then hand the radio to the Tuya SDK.
    for (const scanner of [
      async () => {
        return scanMatter(signal);
      },
      async () => {
        await waitForScan(500, signal);
        return this.scanTuya(signal);
      },
    ]) {
      try {
        const discovered = await scanner();
        candidates.push(...discovered.filter((candidate) =>
          candidate.manufacturerData !== jebaoDmpBleManufacturerMarker &&
          candidate.manufacturerData !== yinmikWaterProductId
        ));
        if (discovered.some(
          (candidate) => candidate.manufacturerData === jebaoBleManufacturerMarker,
        )) {
          break;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push(error);
      }
    }

    if (candidates.length === 0 && failures.length === 2) {
      throw failures[0];
    }

    return deduplicateTuyaCandidates(candidates);
  }

  private async scanTuya(signal?: AbortSignal): Promise<OnboardingCandidate[]> {
    const home = await this.ensureTuyaHome();
    const ownedDevices = await TuyaBridgeModule.getHomeDevices(home.id);
    this.ownedTuyaDevices.clear();
    const ownedCandidates = ownedDevices
      .filter(isWaterQualityDevice)
      .map((device) => {
        this.ownedTuyaDevices.set(device.id, device);
        const address = isPrivateIpv4(device.networkAddress)
          ? device.networkAddress.trim()
          : "";
        return {
          id: device.id,
          transport: "bluetooth-le" as const,
          displayName: `Water Meter${address ? ` · ${address}` : ""} · Already on Wi-Fi`,
          manufacturerData: device.productId,
          serviceUuids: [
            tuyaDiscoveredDeviceMarker,
            tuyaOwnedDeviceMarker,
            tuyaWaterDeviceMarker,
          ],
        };
      });
    TuyaBridgeModule.startBleWifiScan();

    try {
      const deadline = Date.now() + 8_500;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error("Bluetooth scan cancelled");
        const discovered = TuyaBridgeModule.getBleWifiScanCandidates();
        const hasRelevantCandidate = discovered.some((candidate) =>
          this.discoveryKind === "bluetooth" || !candidate.active
        );
        if (hasRelevantCandidate) break;
        await waitForScan(250, signal);
      }
      const nearbyCandidates = TuyaBridgeModule.finishBleWifiScan()
        .filter((candidate) =>
          this.discoveryKind === "bluetooth" || !candidate.active
        )
        .map((candidate) => {
          const isWaterMeter = candidate.productId === yinmikWaterProductId;
          return {
            id: candidate.id,
            transport: "bluetooth-le" as const,
            displayName: isWaterMeter ? "Water Meter" : "Outlet",
            manufacturerData: candidate.productId,
            serviceUuids: [
              tuyaDiscoveredDeviceMarker,
              ...(isWaterMeter ? [tuyaWaterDeviceMarker] : []),
            ],
          };
        });
      const results = [...ownedCandidates, ...nearbyCandidates.filter(
        (candidate) => !this.ownedTuyaDevices.has(candidate.id),
      )];
      console.info(
        "[modREEF Tuya identity]",
        results.map((candidate) => ({
          id: candidate.id,
          productId: candidate.manufacturerData,
          category: candidate.manufacturerData === yinmikWaterProductId ||
            candidate.serviceUuids.includes(tuyaWaterDeviceMarker)
            ? "water-meter"
            : "outlet",
          owned: candidate.serviceUuids.includes(tuyaOwnedDeviceMarker),
        })),
      );
      return results;
    } catch (error) {
      TuyaBridgeModule.stopBleWifiScan();
      throw error;
    }
  }

  async provision(
    candidate: OnboardingCandidate,
    credentials: WifiCredentials,
    signal?: AbortSignal,
  ) {
    if (candidate.manufacturerData === jebaoBleManufacturerMarker) {
      return provisionJebaoBleDevice(candidate, credentials, signal);
    }
    if (signal?.aborted) {
      throw new Error("Device pairing cancelled");
    }

    const home = await this.ensureTuyaHome();

    const productId = candidate.manufacturerData;

    if (!productId) {
      throw new Error(
        "The selected device is missing its product ID",
      );
    }

    const ownedDevice = candidate.serviceUuids.includes(tuyaOwnedDeviceMarker)
      ? this.ownedTuyaDevices.get(candidate.id)
      : undefined;
    let device: TuyaHomeDevice;
    if (ownedDevice) {
      device = await TuyaBridgeModule.refreshDevice(ownedDevice.id);
      if (!device.localKey.trim()) {
        throw new Error(
          "The device did not return its local-control key. Reopen the app and try again.",
        );
      }
    } else {
      const pairing = await TuyaBridgeModule.provisionWifiDevice(
        home.id,
        candidate.id,
        productId,
        credentials.ssid,
        credentials.password,
      );
      if (!pairing.ok) {
        throw new Error(`${pairing.code}: ${pairing.message}`);
      }
      device = await TuyaBridgeModule.refreshDevice(pairing.id);
    }
    const isYinmikWater = isWaterQualityDevice(device);
    if (this.discoveryKind === "bluetooth" && !isYinmikWater) {
      throw new Error(
        "This Bluetooth device does not expose supported water-quality sensors.",
      );
    }
    const displayName = isYinmikWater ? "Water Meter" : "Outlet";

    const handoff = {
      deviceId: device.id,
      localKey: device.localKey,
      ...(isPrivateIpv4(device.networkAddress)
        ? { networkAddress: device.networkAddress.trim() }
        : {}),
      displayName,
      productId,
      initialDps: device.dps,
    };
    console.info("[Tuya recovery] credential handoff", {
      deviceId: handoff.deviceId,
      localKeyLength: handoff.localKey.length,
      networkAddress: handoff.networkAddress ?? "",
      displayName: handoff.displayName,
      productId: handoff.productId,
      initialDpsType: Array.isArray(handoff.initialDps)
        ? "array"
        : typeof handoff.initialDps,
    });
    if (isYinmikWater) {
      await storeYinmikWaterCredentials(handoff);
    } else {
      await storeGHomeWp12Credentials(handoff);
    }

    await registerOnboardedEquipment({
      deviceId: device.id,
      commissioningId: candidate.id,
      displayName,
      transport: "bluetooth-le",
      manufacturer: isYinmikWater ? "YINMIK" : "GHome",
      model: isYinmikWater ? "Water 7-in-1" : "WP12",
    });

    return {
      candidateId: candidate.id,
      accepted: true,
      deviceId: device.id,
      message: ownedDevice
        ? `${displayName} was recovered and handed off to the Reef Controller`
        : `${displayName} joined Wi-Fi and was handed off to the Reef Controller`,
    };
  }
}

const matterCommissioningService = "FFF6";
const tapoCommissioningService = "8641";

async function scanMatter(
  signal?: AbortSignal,
  includeUnidentifiedBluetooth = false,
): Promise<OnboardingCandidate[]> {
  if (signal?.aborted) throw new Error("Bluetooth scan cancelled");

  const peripherals = new Map<string, Peripheral>();
  const dmpPeripheralIds = new Set<string>();
  let resolveRecognizedFound: (() => void) | undefined;
  const recognizedFound = new Promise<void>((resolve) => {
    resolveRecognizedFound = resolve;
  });
  await ensureBleManagerStarted();
  const bleState = await waitForBleReady(signal);
  console.info("[modREEF BLE state]", bleState);
  if (bleState !== "on") {
    throw new Error(
      bleState === "unauthorized"
        ? "Bluetooth access is disabled for modREEF in iPad Settings"
        : `Bluetooth is not ready (${bleState})`,
    );
  }
  const subscription = BleManager.onDiscoverPeripheral((peripheral) => {
    peripherals.set(peripheral.id, peripheral);
    const name = peripheral.name ?? peripheral.advertising.localName;
    if (isJebaoDmpBleAdvertisement({
      name,
      serviceUuids: peripheral.advertising.serviceUUIDs ?? [],
    })) {
      dmpPeripheralIds.add(peripheral.id);
      resolveRecognizedFound?.();
      console.info("[Jebao DMP BLE] advertisement", {
        id: peripheral.id,
        name,
        rssi: peripheral.rssi,
        serviceUUIDs: peripheral.advertising.serviceUUIDs ?? [],
      });
    }
    if (rawTuyaCandidate(peripheral)) resolveRecognizedFound?.();
  });

  try {
    await BleManager.scan({
      // Some commissioning devices advertise their complete service list in
      // a later packet. An iOS service filter can therefore discard them
      // before react-native-ble-manager reports the peripheral.
      serviceUUIDs: [],
      seconds: 8,
      // Jebao initially advertises without a local name, then supplies
      // Jebao_WiFi-* in a later scan-response packet.
      allowDuplicates: true,
    });
    if (includeUnidentifiedBluetooth) {
      // The dedicated Bluetooth action is looking for a locally controlled
      // device. Return as soon as a recognized DMP appears instead of making
      // the user wait for the generic discovery window to expire.
      await Promise.race([
        recognizedFound,
        waitForScan(8_500, signal),
      ]);
    } else {
      await waitForScan(8_500, signal);
    }
  } finally {
    subscription.remove();
    await BleManager.stopScan().catch(() => undefined);
  }

  // iOS may retain a peripheral from a recent scan without delivering a new
  // discovery callback during this scan window. Merge the native cache so a
  // known DMP remains selectable; connecting still verifies it is nearby.
  const cachedPeripherals = await BleManager.getDiscoveredPeripherals()
    .catch(() => [] as Peripheral[]);
  for (const peripheral of cachedPeripherals) {
    if (!peripherals.has(peripheral.id)) peripherals.set(peripheral.id, peripheral);
    if (isJebaoDmpBleAdvertisement({
      name: peripheral.name ?? peripheral.advertising.localName,
      serviceUuids: peripheral.advertising.serviceUUIDs ?? [],
    })) {
      dmpPeripheralIds.add(peripheral.id);
    }
  }

  console.info(
    "[modREEF BLE scan]",
    [...peripherals.values()]
      .sort((left, right) => right.rssi - left.rssi)
      .slice(0, 40)
      .map((peripheral) => ({
        id: peripheral.id,
        name: peripheral.name,
        localName: peripheral.advertising.localName,
        rssi: peripheral.rssi,
        serviceUUIDs: peripheral.advertising.serviceUUIDs ?? [],
        manufacturerData: Object.fromEntries(
          Object.entries(peripheral.advertising.manufacturerData ?? {}).map(
            ([id, value]) => [id, value.data],
          ),
        ),
        manufacturerRawData: peripheral.advertising.manufacturerRawData?.data,
        rawData: peripheral.advertising.rawData?.data,
        serviceData: Object.fromEntries(
          Object.entries(peripheral.advertising.serviceData ?? {}).map(
            ([id, value]) => [id, value.data],
          ),
        ),
      })),
  );

  return [...peripherals.values()].flatMap((peripheral) => {
    const advertisedServices = peripheral.advertising.serviceUUIDs ?? [];
    const advertisedName = peripheral.name ?? peripheral.advertising.localName;
    const tuyaCandidate = rawTuyaCandidate(peripheral);
    if (tuyaCandidate) return [tuyaCandidate];
    if (dmpPeripheralIds.has(peripheral.id) || isJebaoDmpBleAdvertisement({
      name: advertisedName,
      serviceUuids: advertisedServices,
    })) {
      return [{
        id: `jebao-dmp-ble:${peripheral.id}`,
        transport: "bluetooth-le" as const,
        displayName: advertisedName ?? "Jebao DMP",
        signalStrength: peripheral.rssi,
        manufacturerData: jebaoDmpBleManufacturerMarker,
        serviceUuids: advertisedServices,
      }];
    }
    if (isJebaoBleAdvertisement({
      name: advertisedName,
      serviceUuids: advertisedServices,
    })) {
      return [{
        id: `jebao-ble:${peripheral.id}`,
        transport: "bluetooth-le" as const,
        displayName: "Jebao Doser",
        signalStrength: peripheral.rssi,
        manufacturerData: jebaoBleManufacturerMarker,
        serviceUuids: [jebaoBleServiceUuid],
      }];
    }
    const isTapoCommissioning = advertisedServices.some((uuid) =>
      uuid.replaceAll("-", "").toUpperCase().includes(tapoCommissioningService)
    );
    const isMatterCommissioning = advertisedServices.some((uuid) =>
      uuid.replaceAll("-", "").toUpperCase().includes(matterCommissioningService)
    );
    if (!isTapoCommissioning && !isMatterCommissioning) return [];

    return [{
      id: `matter:${peripheral.id}`,
      transport: "bluetooth-le" as const,
      displayName:
        peripheral.name ??
        peripheral.advertising.localName ??
        "Outlet",
      signalStrength: peripheral.rssi,
      manufacturerData: isTapoCommissioning ? "matter-tapo-known-address" : "matter",
      serviceUuids: isTapoCommissioning
        ? [tapoCommissioningService]
        : [matterCommissioningService],
    }];
  });
}

async function waitForBleReady(signal?: AbortSignal): Promise<string> {
  const initial = await BleManager.checkState();
  if (initial !== "unknown" && initial !== "resetting") return initial;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (state: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription.remove();
      signal?.removeEventListener("abort", abort);
      resolve(state);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription.remove();
      reject(new Error("Bluetooth scan cancelled"));
    };
    const subscription = BleManager.onDidUpdateState(({ state }) => {
      if (state !== "unknown" && state !== "resetting") finish(state);
    });
    const timeout = setTimeout(async () => {
      finish(await BleManager.checkState());
    }, 5_000);
    signal?.addEventListener("abort", abort, { once: true });
    void BleManager.checkState().then((state) => {
      if (state !== "unknown" && state !== "resetting") finish(state);
    });
  });
}

async function provisionJebaoBleDevice(
  candidate: OnboardingCandidate,
  credentials: WifiCredentials,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error("Jebao pairing cancelled");
  const candidatePeripheralId = candidate.id.replace(/^jebao-ble:/, "");
  const frame = buildJebaoBleWifiFrame(credentials.ssid, credentials.password);
  await ensureBleManagerStarted();
  const cachedPeripherals = await BleManager.getDiscoveredPeripherals();
  const cachedJebao = cachedPeripherals.find((peripheral) =>
    peripheral.id.toLowerCase() === candidatePeripheralId.toLowerCase() ||
    isJebaoBleAdvertisement({
      name: peripheral.name ?? peripheral.advertising.localName,
      serviceUuids: peripheral.advertising.serviceUUIDs ?? [],
    })
  );
  const peripheralId = cachedJebao?.id ?? candidatePeripheralId;
  console.info("[Jebao BLE] connecting");
  try {
    await withBleTimeout(
      BleManager.connect(peripheralId),
      12_000,
      "Could not connect to Jebao equipment over Bluetooth",
    );
  } catch (error) {
    await BleManager.disconnect(peripheralId, true).catch(() => undefined);
    throw error;
  }
  console.info("[Jebao BLE] connected");

  let notificationSubscription: { remove(): void } | undefined;
  try {
    await withBleTimeout(
      BleManager.retrieveServices(peripheralId, [jebaoBleServiceUuid]),
      10_000,
      "Jebao Bluetooth services could not be read",
    );
    console.info("[Jebao BLE] services ready");
    const accepted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Jebao equipment did not accept the Wi-Fi settings")),
        15_000,
      );
      const abort = () => {
        clearTimeout(timeout);
        reject(new Error("Jebao pairing cancelled"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      notificationSubscription = BleManager.onDidUpdateValueForCharacteristic((event) => {
        if (
          event.peripheral === peripheralId &&
          event.characteristic.replaceAll("-", "").toUpperCase().includes(jebaoBleCharacteristicUuid)
        ) {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", abort);
          resolve();
        }
      });
    });

    await withBleTimeout(
      BleManager.startNotification(
        peripheralId,
        jebaoBleServiceUuid,
        jebaoBleCharacteristicUuid,
      ),
      10_000,
      "Could not subscribe to Jebao setup responses",
    );
    console.info("[Jebao BLE] notifications ready");
    for (const chunk of chunkJebaoBleWifiFrame(frame)) {
      if (signal?.aborted) throw new Error("Jebao pairing cancelled");
      await BleManager.writeWithoutResponse(
        peripheralId,
        jebaoBleServiceUuid,
        jebaoBleCharacteristicUuid,
        chunk,
        20,
        100,
      );
    }
    console.info("[Jebao BLE] credentials sent");
    await accepted;
    console.info("[Jebao BLE] settings accepted");
  } finally {
    notificationSubscription?.remove();
    await BleManager.disconnect(peripheralId, true).catch(() => undefined);
  }

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Jebao pairing cancelled");
    const dosers = await discoverMd44Dosers();
    const doser = dosers[0];
    if (doser) {
      await registerMd44Doser(doser);
      return {
        candidateId: candidate.id,
        accepted: true,
        deviceId: doser.deviceId,
        message: "Jebao equipment joined Wi-Fi and local control is ready",
      };
    }
    await waitForScan(2_000, signal);
  }
  throw new Error("Jebao equipment accepted Wi-Fi settings but did not join the network");
}

async function withBleTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function ensureBleManagerStarted(): Promise<void> {
  if (await BleManager.isStarted()) return;
  await BleManager.start({ showAlert: true });
}

export function createOnboardingTransport(
  discoveryKind: DeviceDiscoveryKind = "wifi",
): OnboardingTransport {
  return new NativeBleTransport(discoveryKind);
}

async function waitForScan(
  milliseconds: number,
  signal?: AbortSignal,
) {
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);

    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      reject(new Error("Bluetooth scan cancelled"));
    };

    signal?.addEventListener("abort", cancel, { once: true });
  });
}
