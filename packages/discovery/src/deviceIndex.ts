import type { DiscoveredDevice } from "./index.js";

export class DeviceIndex {
  private readonly devices = new Map<string, DiscoveredDevice>();
  private readonly aliases = new Map<string, string>();

  add(device: DiscoveredDevice): void {
    const existingKey = this.findExistingKey(device);
    const key = existingKey ?? device.id;

    const existing = this.devices.get(key);
    const merged = existing ? mergeDevices(existing, device) : device;

    this.devices.set(key, merged);
    this.registerAliases(key, merged);
  }

  values(): DiscoveredDevice[] {
    return [...this.devices.values()];
  }

  private findExistingKey(device: DiscoveredDevice): string | undefined {
    for (const alias of aliasesFor(device)) {
      const key = this.aliases.get(alias);

      if (key) {
        return key;
      }
    }

    return undefined;
  }

  private registerAliases(key: string, device: DiscoveredDevice): void {
    for (const alias of aliasesFor(device)) {
      this.aliases.set(alias, key);
    }
  }
}

function aliasesFor(device: DiscoveredDevice): string[] {
  return [
    device.macAddress && `mac:${device.macAddress.toLowerCase()}`,
    device.ipAddress && `ip:${device.ipAddress}`,
    device.hostname && `host:${device.hostname.toLowerCase()}`,
  ].filter((alias): alias is string => Boolean(alias));
}

function mergeDevices(
  first: DiscoveredDevice,
  second: DiscoveredDevice,
): DiscoveredDevice {
  return {
    ...first,
    ...second,
    protocols: [...new Set([...first.protocols, ...second.protocols])],
    services: [
      ...new Set([
        ...(first.services ?? []),
        ...(second.services ?? []),
      ]),
    ],
    metadata: {
      ...first.metadata,
      ...second.metadata,
    },
  };
}
