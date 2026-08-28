import { NativeModule, requireOptionalNativeModule } from "expo";

export type TuyaSdkStatus = {
  sdkLoaded: boolean;
  platform: string;
  loggedIn: boolean;
};

export type TuyaHome = {
  id: string;
  name: string;
  geoName: string;
};

export type TuyaBleWifiCandidate = {
  id: string;
  displayName: string;
  productId: string;
  bleType: number;
  active: boolean;
};

export type TuyaPairedDevice = {
  ok: true;
  id: string;
  name: string;
  productId: string;
  localKey: string;
  networkAddress: string;
  dps: Record<string, unknown>;
  capabilities: string[];
};

export type TuyaHomeDevice = {
  id: string;
  name: string;
  productId: string;
  localKey: string;
  networkAddress: string;
  dps: Record<string, unknown>;
  capabilities: string[];
};

export type TuyaPairingFailure = {
  ok: false;
  code: string;
  message: string;
};

export type TuyaPairingResult =
  | TuyaPairedDevice
  | TuyaPairingFailure;

declare class TuyaBridgeModule extends NativeModule {
  getStatus(): TuyaSdkStatus;
  getHomes(): Promise<TuyaHome[]>;
  getHomeDevices(homeId: string): Promise<TuyaHomeDevice[]>;
  refreshDevice(deviceId: string): Promise<TuyaHomeDevice>;
  removeDevice(deviceId: string): Promise<{ removed: true }>;
  createHome(name: string): Promise<TuyaHome>;
  startBleWifiScan(): void;
  getBleWifiScanCandidates(): TuyaBleWifiCandidate[];
  finishBleWifiScan(): TuyaBleWifiCandidate[];
  stopBleWifiScan(): void;
  resetPairingSession(): void;
  pairWifiDevice(
    homeId: string,
    uuid: string,
    productId: string,
    ssid: string,
    password: string,
  ): Promise<TuyaPairingResult>;
  provisionWifiDevice(
    homeId: string,
    advertisedUuid: string,
    productId: string,
    ssid: string,
    password: string,
  ): Promise<TuyaPairingResult>;
  registerAnonymous(
    countryCode: string,
  ): Promise<{ loggedIn: boolean }>;
}

const unavailableMessage =
  "Tuya provisioning is not included in this build. Build with the official Tuya SDK and explicitly enable the integration.";
const unavailable = (): never => {
  throw new Error(unavailableMessage);
};
const unavailableAsync = async (): Promise<never> => unavailable();

const unavailableModule = {
  getStatus: (): TuyaSdkStatus => ({
    sdkLoaded: false,
    platform: "native",
    loggedIn: false,
  }),
  getHomes: unavailableAsync,
  getHomeDevices: unavailableAsync,
  refreshDevice: unavailableAsync,
  removeDevice: unavailableAsync,
  createHome: unavailableAsync,
  startBleWifiScan: unavailable,
  getBleWifiScanCandidates: (): TuyaBleWifiCandidate[] => [],
  finishBleWifiScan: (): TuyaBleWifiCandidate[] => [],
  stopBleWifiScan: () => undefined,
  resetPairingSession: () => undefined,
  pairWifiDevice: unavailableAsync,
  provisionWifiDevice: unavailableAsync,
  registerAnonymous: unavailableAsync,
} as unknown as TuyaBridgeModule;

const nativeModule = requireOptionalNativeModule<TuyaBridgeModule>("TuyaBridge");

export const tuyaProvisioningAvailable = nativeModule !== null;
export default nativeModule ?? unavailableModule;
