import type { Identifier } from "@modreef/foundation";
import { DeviceIndex } from "./deviceIndex.js";


export type DiscoveryProtocol =
  | "mdns"
  | "ssdp"
  | "arp"
  | "tuya"
  | "matter"
  | "bluetooth"
  | "manual";

export interface DiscoveredDevice {
  id: Identifier;
  protocols: DiscoveryProtocol[];
  displayName?: string;
  manufacturer?: string;
  model?: string;
  ipAddress?: string;
  macAddress?: string;
  hostname?: string;
  services?: string[];
  interfaces?: string[];
  metadata: Record<string, string | number | boolean>;
}

export interface DiscoveryProvider {
  readonly id: Identifier;
  readonly name: string;

  scan(): Promise<DiscoveredDevice[]>;
}

export interface DiscoveryResult {
  devices: DiscoveredDevice[];
  providerErrors: Array<{
    providerId: Identifier;
    message: string;
  }>;
}

export class DiscoveryManager {
  constructor(
    private readonly providers: DiscoveryProvider[],
  ) {}

  async scan(): Promise<DiscoveryResult> {
    const devices = new DeviceIndex();
    const providerErrors: DiscoveryResult["providerErrors"] = [];

    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return {
            provider,
            devices: await provider.scan(),
          };
        } catch (error) {
          providerErrors.push({
            providerId: provider.id,
            message: error instanceof Error ? error.message : String(error),
          });

          return {
            provider,
            devices: [],
            };
            }
          }),
        );

        for (const result of results) {
            for (const device of result.devices) {
            devices.add(device);
          }
        }

        return {
          devices: devices.values(),
          providerErrors,
        };
  }
}

function identityKey(device: DiscoveredDevice): string {
  return (
    device.macAddress?.toLowerCase() ??
    device.ipAddress ??
    device.hostname?.toLowerCase() ??
    device.id
  );
}

function mergeDevices(
  first: DiscoveredDevice,
  second: DiscoveredDevice,
): DiscoveredDevice {
  return {
    ...first,
    ...second,
    protocols: [...new Set([...first.protocols, ...second.protocols])],
    services: [...new Set([...(first.services ?? []), ...(second.services ?? [])])],
    metadata: {
      ...first.metadata,
      ...second.metadata,
    },
  };
}

export { ArpDiscoveryProvider } from "./arpDiscoveryProvider.js";

export { MdnsDiscoveryProvider } from "./mdnsDiscoveryProvider.js";
