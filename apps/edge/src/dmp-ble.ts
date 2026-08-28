import noble, {
  type Characteristic,
  type Peripheral,
} from "@stoprocent/noble";
import type { WavemakerMode } from "@modreef/digital-twin";

const dmpServiceUuid = "abf0";
const dmpCharacteristicUuid = "abf7";

export interface DmpBleIdentity {
  advertisedName: string;
  bluetoothAddress: string;
  signalStrength?: number;
}

export function isDmpPairingName(name: string): boolean {
  return /^(?:XPG-GAgent-[0-9a-f]{4}|W_[0-9a-f]{6})$/i.test(name.trim());
}

export async function discoverDmpBleCandidates(
  timeoutMilliseconds = 8_000,
): Promise<DmpBleIdentity[]> {
  await noble.waitForPoweredOnAsync(timeoutMilliseconds);
  const found = new Map<string, DmpBleIdentity>();
  const onDiscover = (peripheral: Peripheral) => {
    const name = peripheral.advertisement.localName ?? "";
    if (!isDmpPairingName(name)) return;
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(peripheral.address)) return;
    found.set(peripheral.address.toUpperCase(), {
      advertisedName: name,
      bluetoothAddress: peripheral.address.toUpperCase(),
      signalStrength: peripheral.rssi,
    });
  };
  noble.on("discover", onDiscover);
  try {
    await noble.startScanningAsync([], true);
    await new Promise((resolve) => setTimeout(resolve, timeoutMilliseconds));
  } finally {
    noble.removeListener("discover", onDiscover);
    await noble.stopScanningAsync().catch(() => undefined);
  }
  return [...found.values()].sort(
    (left, right) => (right.signalStrength ?? -200) - (left.signalStrength ?? -200),
  );
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

export async function discoverDmpBleIdentity(
  advertisedName: string,
  timeoutMilliseconds = 15_000,
): Promise<DmpBleIdentity> {
  await noble.waitForPoweredOnAsync(timeoutMilliseconds);
  const wanted = normalizedName(advertisedName);

  return new Promise<DmpBleIdentity>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, identity?: DmpBleIdentity) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      noble.removeListener("discover", onDiscover);
      void noble.stopScanningAsync().catch(() => undefined);
      if (error) reject(error);
      else resolve(identity!);
    };
    const onDiscover = (peripheral: Peripheral) => {
      const name = peripheral.advertisement.localName ?? "";
      if (normalizedName(name) !== wanted) return;
      if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(peripheral.address)) {
        finish(new Error("The DMP-40 did not expose a stable Bluetooth address"));
        return;
      }
      finish(undefined, {
        advertisedName: name,
        bluetoothAddress: peripheral.address.toUpperCase(),
        signalStrength: peripheral.rssi,
      });
    };
    const timer = setTimeout(() => {
      finish(new Error(`The Edge controller could not find ${advertisedName} over Bluetooth`));
    }, timeoutMilliseconds);
    noble.on("discover", onDiscover);
    // XPG pairing advertisements expose the device name and public address,
    // but do not consistently include ABF0 until after connection. Scan all
    // BLE advertisements and retain the strict exact-name check above.
    void noble.startScanningAsync([], true).catch((cause: unknown) => {
      finish(cause instanceof Error ? cause : new Error(String(cause)));
    });
  });
}

export async function verifyDmpBleIdentity(
  identity: DmpBleIdentity,
  timeoutMilliseconds = 12_000,
): Promise<void> {
  await noble.waitForPoweredOnAsync(timeoutMilliseconds);
  const peripheral = await noble.connectAsync(identity.bluetoothAddress, {
    addressType: "public",
    timeout: timeoutMilliseconds,
  });
  try {
    const discovered = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [dmpServiceUuid], [dmpCharacteristicUuid],
    );
    const characteristic = discovered.characteristics.find(
      ({ uuid }) => uuid.toLowerCase() === dmpCharacteristicUuid,
    );
    if (!characteristic ||
      !characteristic.properties.includes("writeWithoutResponse") ||
      !characteristic.properties.includes("notify")) {
      throw new Error("The selected Bluetooth device is not a supported Jebao DMP wavemaker");
    }
  } finally {
    await peripheral.disconnectAsync().catch(() => undefined);
  }
}

export const dmpBleGatt = {
  serviceUuid: dmpServiceUuid,
  characteristicUuid: dmpCharacteristicUuid,
} as const;

const modeByte: Record<WavemakerMode, number> = {
  M1: 0x20,
  M2: 0x28,
  M3: 0x38,
  M4: 0x30,
  M5: 0x21,
};

function transactionBytes(transaction: number): Buffer {
  const value = Buffer.alloc(4);
  value.writeUInt32BE(transaction >>> 0);
  return value;
}

const challengePrefix = Buffer.from("000000030d0000070008", "hex");

export function buildDmpChallengeResponse(challenge: Buffer): Buffer {
  if (challenge.length !== challengePrefix.length + 8 ||
    !challenge.subarray(0, challengePrefix.length).equals(challengePrefix)) {
    throw new Error("DMP-40 authentication challenge is invalid");
  }
  return Buffer.concat([
    Buffer.from("000000030d0000080008", "hex"),
    challenge.subarray(challengePrefix.length),
  ]);
}

export function buildDmpModeFrame(
  transaction: number,
  mode: WavemakerMode,
  speedPercent: number,
  pulseFrequency = 100,
): Buffer {
  const speed = Math.max(0, Math.min(100, Math.round(speedPercent)));
  const frequency = Math.max(5, Math.min(100, Math.round(pulseFrequency)));
  return Buffer.concat([
    Buffer.from("0000000314000093", "hex"),
    transactionBytes(transaction),
    Buffer.from("1100000000000001b406", "hex"),
    Buffer.from([modeByte[mode], speed, frequency]),
  ]);
}

export function buildDmpPowerFrame(transaction: number, on: boolean): Buffer {
  return Buffer.concat([
    Buffer.from("0000000312000093", "hex"),
    transactionBytes(transaction),
    Buffer.from("11000000000000000001", "hex"),
    Buffer.from([on ? 0x01 : 0x00, 0x00]),
  ]);
}

export class DmpBleController {
  private peripheral: Peripheral | undefined;
  private characteristic: Characteristic | undefined;
  private transaction = 1;
  private readonly notifications: Buffer[] = [];
  private notificationWaiter: (() => void) | undefined;

  constructor(private readonly bluetoothAddress: string) {}

  async connect(): Promise<void> {
    await noble.waitForPoweredOnAsync(10_000);
    this.peripheral = await noble.connectAsync(this.bluetoothAddress, {
      addressType: "public",
      timeout: 12_000,
    });
    const discovered = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [dmpServiceUuid], [dmpCharacteristicUuid],
    );
    this.characteristic = discovered.characteristics.find(
      ({ uuid }) => uuid.toLowerCase() === dmpCharacteristicUuid,
    );
    if (!this.characteristic) throw new Error("DMP-40 ABF7 characteristic was not found");
    this.characteristic.on("data", (data) => {
      this.notifications.push(Buffer.from(data));
      this.notificationWaiter?.();
    });
    await this.characteristic.subscribeAsync();
    await this.authenticate();
  }

  async disconnect(): Promise<void> {
    const peripheral = this.peripheral;
    this.characteristic = undefined;
    this.peripheral = undefined;
    this.notifications.length = 0;
    if (peripheral) {
      await Promise.race([
        peripheral.disconnectAsync().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
      ]);
    }
  }

  async setMode(mode: WavemakerMode, speedPercent: number, pulseFrequency = 100): Promise<void> {
    const transaction = this.nextTransaction();
    const requested = buildDmpModeFrame(transaction, mode, speedPercent, pulseFrequency);
    await this.write(requested);
    await this.waitFor((frame) =>
      frame.length === requested.length &&
      frame.subarray(0, 8).equals(requested.subarray(0, 8)) &&
      frame[12] === 0x14 &&
      frame.subarray(13).equals(requested.subarray(13))
    );
  }

  async setPower(on: boolean): Promise<void> {
    const transaction = this.nextTransaction();
    const requested = buildDmpPowerFrame(transaction, on);
    await this.write(requested);
    await this.waitFor((frame) =>
      frame.length >= 11 &&
      frame.subarray(0, 7).equals(Buffer.from("00000003070000", "hex")) &&
      frame.subarray(-4).equals(transactionBytes(transaction))
    );
  }

  private async authenticate(): Promise<void> {
    await this.write(Buffer.from("0000000303000006", "hex"));
    const challenge = await this.waitFor((frame) =>
      frame.length === challengePrefix.length + 8 &&
      frame.subarray(0, challengePrefix.length).equals(challengePrefix)
    );
    await this.write(buildDmpChallengeResponse(challenge));
    await this.waitFor((frame) =>
      frame.equals(Buffer.from("000000030400000900", "hex"))
    );

    const address = Buffer.from(this.bluetoothAddress.replaceAll(":", ""), "hex");
    if (address.length !== 6) throw new Error("DMP-40 Bluetooth address is invalid");
    const identity = Buffer.concat([
      Buffer.from("000000030f000065010000000001", "hex"),
      address,
    ]);
    await this.write(identity);
    await this.waitFor((frame) =>
      frame.length === identity.length &&
      frame.subarray(0, 8).equals(Buffer.from("000000030f000066", "hex")) &&
      frame.subarray(8).equals(identity.subarray(8))
    );
  }

  private nextTransaction(): number {
    const current = this.transaction;
    this.transaction = this.transaction >= 0xffff_fffe ? 1 : this.transaction + 1;
    return current;
  }

  private async write(frame: Buffer): Promise<void> {
    if (!this.characteristic) throw new Error("DMP-40 is not connected");
    // ABF7 is a write-without-response characteristic. The DMP accepts the
    // frame immediately, but some BlueZ/Noble combinations never invoke the
    // write callback, leaving an otherwise successful command pending forever.
    // Bound the transport callback; protocol confirmation is handled by the
    // notification wait that follows each write.
    await Promise.race([
      this.characteristic.writeAsync(frame, true),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }

  private async waitFor(
    predicate: (frame: Buffer) => boolean,
    timeoutMilliseconds = 4_000,
  ): Promise<Buffer> {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      const index = this.notifications.findIndex(predicate);
      if (index >= 0) return this.notifications.splice(index, 1)[0]!;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.notificationWaiter = undefined;
          reject(new Error("DMP-40 did not acknowledge the Bluetooth command"));
        }, Math.max(1, deadline - Date.now()));
        this.notificationWaiter = () => {
          clearTimeout(timer);
          this.notificationWaiter = undefined;
          resolve();
        };
      });
    }
    throw new Error("DMP-40 did not acknowledge the Bluetooth command");
  }
}
