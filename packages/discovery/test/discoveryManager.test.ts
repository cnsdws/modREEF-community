import { describe, expect, it } from "vitest";

import {
  DiscoveryManager,
  type DiscoveryProvider,
} from "../src/index";

describe("DiscoveryManager", () => {
  it("combines results from multiple providers", async () => {
    const mdns: DiscoveryProvider = {
      id: "mdns",
      name: "mDNS",
      async scan() {
        return [
          {
            id: "device-a",
            protocols: ["mdns"],
            hostname: "strip.local",
            ipAddress: "10.0.0.60",
            metadata: {},
          },
        ];
      },
    };

    const arp: DiscoveryProvider = {
      id: "arp",
      name: "ARP",
      async scan() {
        return [
          {
            id: "device-b",
            protocols: ["arp"],
            ipAddress: "10.0.0.61",
            macAddress: "AA:BB:CC:DD:EE:FF",
            metadata: {},
          },
        ];
      },
    };

    const result = await new DiscoveryManager([
      mdns,
      arp,
    ]).scan();

    expect(result.devices).toHaveLength(2);
    expect(result.providerErrors).toHaveLength(0);
  });

  it("merges devices sharing the same MAC address", async () => {
    const first: DiscoveryProvider = {
      id: "first",
      name: "First",
      async scan() {
        return [
          {
            id: "one",
            protocols: ["arp"],
            macAddress: "AA:BB:CC:DD:EE:FF",
            ipAddress: "10.0.0.61",
            metadata: {},
          },
        ];
      },
    };

    const second: DiscoveryProvider = {
      id: "second",
      name: "Second",
      async scan() {
        return [
          {
            id: "two",
            protocols: ["tuya"],
            macAddress: "aa:bb:cc:dd:ee:ff",
            manufacturer: "GHome",
            metadata: {
              source: "tuya",
            },
          },
        ];
      },
    };

    const result = await new DiscoveryManager([
      first,
      second,
    ]).scan();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.protocols).toEqual([
      "arp",
      "tuya",
    ]);
    expect(result.devices[0]?.manufacturer).toBe("GHome");
  });

  it("records provider failures without failing the whole scan", async () => {
    const failing: DiscoveryProvider = {
      id: "failing-provider",
      name: "Failing Provider",
      async scan() {
        throw new Error("Network unavailable");
      },
    };

    const result = await new DiscoveryManager([
      failing,
    ]).scan();

    expect(result.devices).toHaveLength(0);
    expect(result.providerErrors).toHaveLength(1);
    expect(result.providerErrors[0]?.message).toBe(
      "Network unavailable",
    );
  });
});
