import dgram from "node:dgram";

const guidePacketLengths = [515, 514, 513, 512] as const;
const dataLengthOffset = 40;
const targetPort = 7001;
const packetsPerDatum = 3;

export interface MdpAirLinkInput {
  ssid: string;
  password: string;
  bssid: string;
  localAddress: string;
}

export interface MdpAirLinkPlan {
  guidePacketLengths: readonly number[];
  dataPacketLengths: readonly number[];
}

export interface MdpAirLinkOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  guideDurationMs?: number;
  dataDurationMs?: number;
  intervalMs?: number;
}

export function createMdpAirLinkPlan(input: MdpAirLinkInput): MdpAirLinkPlan {
  const ssid = Buffer.from(input.ssid, "utf8");
  const password = Buffer.from(input.password, "utf8");
  const bssid = parseMac(input.bssid);
  const localAddress = parseIpv4(input.localAddress);
  if (ssid.length < 1 || ssid.length > 32) {
    throw new Error("MDP AirLink Wi-Fi name must contain 1 through 32 UTF-8 bytes");
  }
  if (password.length < 8 || password.length > 63) {
    throw new Error("MDP AirLink Wi-Fi password must contain 8 through 63 UTF-8 bytes");
  }

  const totalLength = 5 + localAddress.length + password.length + ssid.length;
  const values = [
    totalLength,
    password.length,
    crc8(ssid),
    crc8(bssid),
    0,
    ...localAddress,
    ...password,
    ...ssid,
  ];
  values[4] = values.reduce((result, value, index) =>
    index === 4 ? result : result ^ value, 0);

  const datums = values.map((value, index) => ({ value, index }));
  bssid.forEach((value, offset) => {
    datums.splice(5 + (offset * 4), 0, { value, index: totalLength + offset });
  });
  return {
    guidePacketLengths,
    dataPacketLengths: datums.flatMap(({ value, index }) => encodeDatum(value, index)),
  };
}

export async function transmitMdpAirLink(
  input: MdpAirLinkInput,
  options: MdpAirLinkOptions = {},
): Promise<void> {
  const plan = createMdpAirLinkPlan(input);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const guideDurationMs = options.guideDurationMs ?? 2_000;
  const dataDurationMs = options.dataDurationMs ?? 4_000;
  const intervalMs = options.intervalMs ?? 8;
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let multicastIndex = 0;
  let settled = false;

  const sendLength = async (length: number) => {
    multicastIndex = (multicastIndex % 100) + 1;
    const address = `234.${multicastIndex}.${multicastIndex}.${multicastIndex}`;
    await new Promise<void>((resolve, reject) => {
      socket.send(Buffer.alloc(length), targetPort, address, (error) =>
        error ? reject(error) : resolve());
    });
    await wait(intervalMs, options.signal);
  };

  return await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => finish(), timeoutMs);
    const abort = () => finish(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error("MDP AirLink cancelled"),
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abort);
      socket.close();
      error ? reject(error) : resolve();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) return abort();
    socket.on("error", (error) => finish(error));
    socket.bind(0, input.localAddress, async () => {
      try {
        socket.setMulticastInterface(input.localAddress);
        const startedAt = Date.now();
        while (!settled && Date.now() - startedAt < timeoutMs) {
          const guideStartedAt = Date.now();
          while (!settled && Date.now() - guideStartedAt < guideDurationMs) {
            for (const length of plan.guidePacketLengths) await sendLength(length);
          }
          const dataStartedAt = Date.now();
          let cursor = 0;
          while (!settled && Date.now() - dataStartedAt < dataDurationMs) {
            for (let count = 0; count < packetsPerDatum; count += 1) {
              await sendLength(plan.dataPacketLengths[(cursor + count) % plan.dataPacketLengths.length]!);
            }
            cursor = (cursor + packetsPerDatum) % plan.dataPacketLengths.length;
          }
        }
        finish();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function parseMac(value: string): Buffer {
  if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value)) {
    throw new Error("MDP AirLink BSSID must be a colon-delimited MAC address");
  }
  return Buffer.from(value.replaceAll(":", ""), "hex");
}

function parseIpv4(value: string): Buffer {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) =>
    !Number.isInteger(item) || item < 0 || item > 255)) {
    throw new Error("MDP AirLink local address must be IPv4");
  }
  return Buffer.from(octets);
}

function crc8(input: Uint8Array): number {
  let value = 0;
  for (const byte of input) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0x8c : value >>> 1;
    }
  }
  return value & 0xff;
}

function encodeDatum(value: number, index: number): number[] {
  if (index > 127) throw new Error("MDP AirLink payload is too long");
  const checksum = crc8(Uint8Array.of(value, index));
  return [
    ((checksum & 0xf0) | ((value >>> 4) & 0x0f)) + dataLengthOffset,
    (0x100 | index) + dataLengthOffset,
    (((checksum & 0x0f) << 4) | (value & 0x0f)) + dataLengthOffset,
  ];
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("MDP AirLink cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
