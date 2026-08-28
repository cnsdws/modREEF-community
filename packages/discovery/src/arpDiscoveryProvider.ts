import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  DiscoveredDevice,
  DiscoveryProvider,
} from "./index.js";

const execFileAsync = promisify(execFile);

export class ArpDiscoveryProvider implements DiscoveryProvider {
  readonly id = "arp";
  readonly name = "ARP Discovery";

  async scan(): Promise<DiscoveredDevice[]> {
    const { stdout } = await execFileAsync("ip", ["neigh"]);

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("FAILED"))
      .map(parseNeighbor)
      .filter((device): device is DiscoveredDevice => device !== null);
  }
}

export function parseNeighbor(line: string): DiscoveredDevice | null {
  const match = line.match(
    /^(\d{1,3}(?:\.\d{1,3}){3})\s+dev\s+(\S+)\s+lladdr\s+([0-9a-f:]{17})\s+([A-Z]+)$/i,
  );

  if (!match) {
    return null;
  }

  const [, ipAddress, networkInterface, macAddress, neighborState] = match;

  if (!ipAddress || !networkInterface || !macAddress || !neighborState) {
    return null;
  }

  return {
    id: `arp:${macAddress.toLowerCase()}`,
    protocols: ["arp"],
    ipAddress,
    macAddress: macAddress.toLowerCase(),
    interfaces: [networkInterface],
    metadata: {
      neighborState,
    },
  };
}
