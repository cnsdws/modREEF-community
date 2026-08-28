import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type OnboardingTransportKind = "bluetooth-le";

export const controllerOnboardingServiceUuid = "7b8f0001-6e7d-4d5f-9a2e-4f6d6f645246";
export const controllerIdentityCharacteristicUuid = "7b8f0002-6e7d-4d5f-9a2e-4f6d6f645246";
export const controllerProvisionCharacteristicUuid = "7b8f0003-6e7d-4d5f-9a2e-4f6d6f645246";
export const controllerStatusCharacteristicUuid = "7b8f0004-6e7d-4d5f-9a2e-4f6d6f645246";

export interface ControllerBleIdentity {
  version: 1;
  setupId: string;
  hardwareSerial: string;
  serverNonce: string;
}

export interface ControllerWifiProvisioningEnvelope {
  version: 1;
  setupId: string;
  clientNonce: string;
  ciphertext: string;
}

export interface ControllerProvisioningStatus {
  state: "ready" | "configuring" | "joining" | "connected" | "failed";
  message: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64Url(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    result += base64Alphabet[a >> 2];
    result += base64Alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) result += base64Alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) result += base64Alphabet[c & 63];
  }
  return result.replaceAll("+", "-").replaceAll("/", "_");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid onboarding credential encoding");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const character = normalized[index + offset];
      return character === undefined ? 0 : base64Alphabet.indexOf(character);
    });
    if (values.some((item) => item < 0)) throw new Error("Invalid onboarding credential encoding");
    bytes.push((values[0]! << 2) | (values[1]! >> 4));
    if (index + 2 < normalized.length) bytes.push(((values[1]! & 15) << 4) | (values[2]! >> 2));
    if (index + 3 < normalized.length) bytes.push(((values[2]! & 3) << 6) | values[3]!);
  }
  return Uint8Array.from(bytes);
}

function provisioningKey(claimSecret: string, identity: ControllerBleIdentity, clientNonce: Uint8Array): Uint8Array {
  const secret = decodeBase64Url(claimSecret);
  if (secret.length !== 32) throw new Error("Invalid Reef Controller setup secret");
  const serverNonce = decodeBase64Url(identity.serverNonce);
  if (serverNonce.length !== 24 || clientNonce.length !== 24) throw new Error("Invalid onboarding session nonce");
  const salt = new Uint8Array(serverNonce.length + clientNonce.length);
  salt.set(serverNonce);
  salt.set(clientNonce, serverNonce.length);
  return hkdf(sha256, secret, salt, encoder.encode("modreef-controller-wifi-v1"), 32);
}

function provisioningAad(identity: ControllerBleIdentity): Uint8Array {
  return encoder.encode(`modreef-controller-wifi-v1:${identity.hardwareSerial}:${identity.setupId}`);
}

/** Encrypts Wi-Fi credentials for one QR-authenticated BLE session. */
export function sealControllerWifiCredentials(
  identity: ControllerBleIdentity,
  claimSecret: string,
  credentials: WifiCredentials,
  clientNonce: Uint8Array,
): ControllerWifiProvisioningEnvelope {
  if (!credentials.ssid.trim() || credentials.ssid.length > 32 || credentials.password.length < 8 || credentials.password.length > 63) {
    throw new Error("Enter a valid Wi-Fi network and password");
  }
  const key = provisioningKey(claimSecret, identity, clientNonce);
  const plaintext = encoder.encode(JSON.stringify({ ssid: credentials.ssid, password: credentials.password }));
  const ciphertext = xchacha20poly1305(key, clientNonce, provisioningAad(identity)).encrypt(plaintext);
  return {
    version: 1,
    setupId: identity.setupId,
    clientNonce: encodeBase64Url(clientNonce),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

/** Authenticates and decrypts a tablet provisioning envelope on the controller. */
export function openControllerWifiCredentials(
  identity: ControllerBleIdentity,
  claimSecret: string,
  envelope: ControllerWifiProvisioningEnvelope,
): WifiCredentials {
  if (envelope.version !== 1 || envelope.setupId !== identity.setupId) throw new Error("Onboarding identity mismatch");
  const clientNonce = decodeBase64Url(envelope.clientNonce);
  const key = provisioningKey(claimSecret, identity, clientNonce);
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(key, clientNonce, provisioningAad(identity)).decrypt(
      decodeBase64Url(envelope.ciphertext),
    );
  } catch {
    throw new Error("Reef Controller setup credential was rejected");
  }
  const parsed = JSON.parse(decoder.decode(plaintext)) as { ssid?: unknown; password?: unknown };
  if (typeof parsed.ssid !== "string" || !parsed.ssid.trim() || parsed.ssid.length > 32 ||
    typeof parsed.password !== "string" || parsed.password.length < 8 || parsed.password.length > 63) {
    throw new Error("Invalid Wi-Fi credentials");
  }
  return { ssid: parsed.ssid, password: parsed.password };
}

export interface OnboardingCandidate {
  id: string;
  transport: OnboardingTransportKind;
  displayName: string;
  signalStrength?: number;
  manufacturerData?: string;
  serviceUuids: string[];
}

export interface WifiCredentials {
  ssid: string;
  password: string;
}

export interface ProvisioningResult {
  candidateId: string;
  accepted: boolean;
  deviceId?: string;
  message: string;
}

export interface OnboardingTransport {
  readonly kind: OnboardingTransportKind;

  scan(signal?: AbortSignal): Promise<OnboardingCandidate[]>;

  provision(
    candidate: OnboardingCandidate,
    credentials: WifiCredentials,
    signal?: AbortSignal,
  ): Promise<ProvisioningResult>;
}

export type OnboardingState =
  | { status: "idle" }
  | { status: "scanning" }
  | {
      status: "selecting";
      candidates: OnboardingCandidate[];
    }
  | {
      status: "provisioning";
      candidate: OnboardingCandidate;
    }
  | {
      status: "completed";
      result: ProvisioningResult;
    }
  | {
      status: "failed";
      message: string;
    };

export class OnboardingSession {
  private state: OnboardingState = { status: "idle" };

  constructor(
    private readonly transport: OnboardingTransport,
  ) {}

  getState(): OnboardingState {
    return this.state;
  }

  async scan(signal?: AbortSignal): Promise<OnboardingState> {
    this.state = { status: "scanning" };

    try {
      const candidates = await this.transport.scan(signal);
      this.state = {
        status: "selecting",
        candidates,
      };
    } catch (error) {
      this.state = {
        status: "failed",
        message:
          error instanceof Error ? error.message : String(error),
      };
    }

    return this.state;
  }

  async provision(
    candidate: OnboardingCandidate,
    credentials: WifiCredentials,
    signal?: AbortSignal,
  ): Promise<OnboardingState> {
    this.state = {
      status: "provisioning",
      candidate,
    };

    try {
      const result = await this.transport.provision(
        candidate,
        credentials,
        signal,
      );

      this.state = result.accepted
        ? { status: "completed", result }
        : { status: "failed", message: result.message };
    } catch (error) {
      this.state = {
        status: "failed",
        message:
          error instanceof Error ? error.message : String(error),
      };
    }

    return this.state;
  }
}
