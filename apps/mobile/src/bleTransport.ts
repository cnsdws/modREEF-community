import type {
  OnboardingCandidate,
  OnboardingTransport,
  WifiCredentials,
} from "@modreef/onboarding";

export {
  yinmikWaterProductId,
  tuyaDiscoveredDeviceMarker,
  tuyaOwnedDeviceMarker,
  tuyaWaterDeviceMarker,
} from "./tuyaIdentityConstants";

const candidate: OnboardingCandidate = {
  id: "simulated-ble-outlet",
  transport: "bluetooth-le",
  displayName: "Nearby smart outlet (simulated)",
  signalStrength: -42,
  serviceUuids: [],
};

class SimulatedBleTransport implements OnboardingTransport {
  readonly kind = "bluetooth-le" as const;

  async scan() {
    await delay(600);
    return [candidate];
  }

  async provision(
    selected: OnboardingCandidate,
    credentials: WifiCredentials,
  ) {
    await delay(800);

    return {
      candidateId: selected.id,
      accepted: credentials.ssid.trim().length > 0,
      deviceId: "simulated-smart-outlet",
      message: "Simulated device joined Wi-Fi",
    };
  }
}

export type DeviceDiscoveryKind = "bluetooth" | "wifi";

export interface BluetoothGattInspection {
  services: string[];
  characteristics: Array<{
    service: string;
    characteristic: string;
    properties: string[];
  }>;
}

export async function inspectJebaoDmpDevice(
  _candidate: OnboardingCandidate,
): Promise<BluetoothGattInspection> {
  throw new Error("Jebao wavemaker inspection requires the tablet app.");
}

export async function refreshOwnedYinmikWaterCredentials(): Promise<boolean> {
  return false;
}

export async function removeOwnedTuyaDevice(_deviceId: string): Promise<void> {
  throw new Error("Tuya device removal requires the tablet app.");
}

export function createOnboardingTransport(
  _discoveryKind: DeviceDiscoveryKind = "wifi",
): OnboardingTransport {
  return new SimulatedBleTransport();
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds),
  );
}
