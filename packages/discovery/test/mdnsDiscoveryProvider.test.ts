import { describe, expect, it } from "vitest";

import { parseMdnsRecord } from "../src/mdnsDiscoveryProvider.js";

describe("parseMdnsRecord", () => {
  it("parses a resolved IPv4 mDNS record", () => {
    expect(
      parseMdnsRecord(
        '=;wlan0;IPv4;Denon\\032AVR;_http._tcp;local;denon.local;10.0.0.50;80;"key=value"',
      ),
    ).toEqual({
      id: "mdns:denon.local",
      protocols: ["mdns"],
      displayName: "Denon AVR",
      hostname: "denon.local",
      ipAddress: "10.0.0.50",
      services: ["_http._tcp"],
      interfaces: ["wlan0"],
      metadata: {},
    });
  });

  it("ignores unresolved records", () => {
    expect(
      parseMdnsRecord(
        "+;wlan0;IPv4;Denon\\032AVR;_http._tcp;local",
      ),
    ).toBeNull();
  });

  it("ignores IPv6 records", () => {
    expect(
      parseMdnsRecord(
        '=;wlan0;IPv6;Denon\\032AVR;_http._tcp;local;denon.local;fe80::1;80;"key=value"',
      ),
    ).toBeNull();
  });
});
