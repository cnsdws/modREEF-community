import { createSocket } from "node:dgram";

const discoveryPort = 12_414;
const discoveryRequest = Buffer.from([0, 0, 0, 3, 3, 0, 0, 3]);

export interface JebaoMd44DiscoveredDevice {
  deviceId: string;
  gizwitsDeviceId: string;
  networkAddress: string;
  macAddress: string;
  moduleId: string;
  productKey?: string;
  firmwareVersion?: string;
}

export interface JebaoMd44DiscoveryOptions {
  localAddress?: string;
  targetAddress?: string;
  socketFactory?: typeof createSocket;
}

export function decodeJebaoMd44DiscoveryResponse(
  response: Buffer,
  networkAddress: string,
): JebaoMd44DiscoveredDevice | undefined {
  if (
    response.length < 48 ||
    !response.subarray(0, 4).equals(discoveryRequest.subarray(0, 4))
  ) return undefined;

  let offset = 8;
  const fields: Buffer[] = [];
  for (let index = 0; index < 4; index += 1) {
    if (response[offset] !== 0) return undefined;
    const length = response[offset + 1];
    if (length === undefined || offset + 2 + length > response.length) return undefined;
    fields.push(response.subarray(offset + 2, offset + 2 + length));
    offset += 2 + length;
  }

  const [did, mac, module, product] = fields;
  if (!did?.length || !mac || mac.length !== 6 || !module?.length) return undefined;
  const gizwitsDeviceId = did.toString("ascii");
  const macAddress = [...mac]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":");
  const firmwareMatch = response.toString("ascii").match(/\b\d+\.\d+\.\d+\b/);
  return {
    deviceId: `md44-${macAddress.replaceAll(":", "")}`,
    gizwitsDeviceId,
    networkAddress,
    macAddress,
    moduleId: module.toString("ascii"),
    ...(product?.length ? { productKey: product.toString("ascii") } : {}),
    ...(firmwareMatch?.[0] ? { firmwareVersion: firmwareMatch[0] } : {}),
  };
}

export async function discoverJebaoMd44Dosers(
  timeoutMs = 3_000,
  options: JebaoMd44DiscoveryOptions = {},
): Promise<JebaoMd44DiscoveredDevice[]> {
  const socket = (options.socketFactory ?? createSocket)("udp4");
  const found = new Map<string, JebaoMd44DiscoveredDevice>();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => finish(), timeoutMs);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (quietTimer) clearTimeout(quietTimer);
      if (retryTimer) clearInterval(retryTimer);
      socket.close();
      error ? reject(error) : resolve();
    };
    socket.on("message", (message, remote) => {
      const device = decodeJebaoMd44DiscoveryResponse(message, remote.address);
      if (!device) return;
      found.set(device.deviceId, device);
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(), 250);
    });
    socket.once("error", (error) => finish(error));
    socket.bind(0, options.localAddress, () => {
      socket.setBroadcast(true);
      const send = () => socket.send(
        discoveryRequest,
        discoveryPort,
        options.targetAddress ?? "255.255.255.255",
        (error) => error && finish(error),
      );
      send();
      retryTimer = setInterval(send, 1_000);
    });
  });
  return [...found.values()];
}
