import { describe, expect, it } from "vitest";

import { parseNeighbor } from "../src/arpDiscoveryProvider.js";

describe("parseNeighbor", () => {
  it("parses a valid IPv4 neighbor", () => {
    expect(
      parseNeighbor(
        "10.0.0.136 dev wlan0 lladdr c8:a3:62:d3:94:0e STALE",
      ),
    ).toEqual({
      id: "arp:c8:a3:62:d3:94:0e",
      protocols: ["arp"],
      ipAddress: "10.0.0.136",
      macAddress: "c8:a3:62:d3:94:0e",
      interfaces: ["wlan0"],
      metadata: {
        neighborState: "STALE",
      },
    });
  });

  it("ignores IPv6 neighbors", () => {
    expect(
      parseNeighbor(
        "fe80::1 dev wlan0 lladdr c8:a3:62:d3:94:0e STALE",
      ),
    ).toBeNull();
  });

  it("ignores failed entries", () => {
    expect(
      parseNeighbor("10.0.0.50 dev wlan0 FAILED"),
    ).toBeNull();
  });
});
