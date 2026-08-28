import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  DiscoveredDevice,
  DiscoveryProvider,
} from "./index.js";

const execFileAsync = promisify(execFile);

export class MdnsDiscoveryProvider implements DiscoveryProvider {
  readonly id = "mdns";
  readonly name = "mDNS Discovery";

  async scan(): Promise<DiscoveredDevice[]> {
    const { stdout } = await execFileAsync("avahi-browse", [
      "--all",
      "--resolve",
      "--terminate",
      "--parsable",
    ]);

    const devices = new Map<string, DiscoveredDevice>();

    for (const line of stdout.split("\n")) {
      const device = parseMdnsRecord(line);

      if (!device) {
        continue;
      }

      const key = `${device.hostname ?? ""}|${device.ipAddress ?? ""}`;
      const existing = devices.get(key);

      devices.set(
        key,
        existing
          ? {
              ...existing,
              services: [
                ...new Set([
                  ...(existing.services ?? []),
                  ...(device.services ?? []),
                ]),
              ],
            }
          : device,
      );
    }

    return [...devices.values()];
  }
}

export function parseMdnsRecord(line: string): DiscoveredDevice | null {
  if (!line.startsWith("=")) {
    return null;
  }

  const fields = line.split(";");

  if (fields.length < 10 || fields[2] !== "IPv4") {
    return null;
  }

  const [
    ,
    networkInterface,
    ,
    displayName,
    serviceType,
    ,
    hostname,
    ipAddress,
  ] = fields;

  if (
    !networkInterface ||
    !displayName ||
    !serviceType ||
    !hostname ||
    !ipAddress ||
    networkInterface === "lo" ||
    networkInterface.startsWith("docker")
  ) {
    return null;
  }

  return {
    id: `mdns:${hostname}`,
    protocols: ["mdns"],
    displayName: decodeAvahi(displayName),
    hostname: decodeAvahi(hostname),
    ipAddress,
    services: [serviceType],
    interfaces: [networkInterface],
    metadata: {},
  };
}

function decodeAvahi(text: string): string {
  const bytes: number[] = [];

  for (let i = 0; i < text.length;) {
    if (text[i] === "\\" && /^\d{3}/.test(text.slice(i + 1, i + 4))) {
      bytes.push(Number(text.slice(i + 1, i + 4)));
      i += 4;
    } else {
      bytes.push(text.charCodeAt(i));
      i++;
    }
  }

  return Buffer.from(bytes).toString("utf8");
}
