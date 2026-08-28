import { describe, expect, it } from "vitest";
import {
  parseIwInterfaces,
  parseIwLink,
  parseNmcliActiveAccessPoint,
  parseNmcliWifiDevice,
} from "../src/mdp-airlink-network.js";

describe("MDP AirLink network inspection", () => {
  it("parses wireless interfaces", () => {
    expect(parseIwInterfaces("phy#0\n\tInterface wlan0\nphy#1\n\tInterface wlan1\n"))
      .toEqual(["wlan0", "wlan1"]);
  });

  it("parses the active access point without trimming the SSID internally", () => {
    expect(parseIwLink("Connected to AA:BB:CC:DD:EE:FF (on wlan0)\n\tSSID: Reef WiFi\n"))
      .toEqual({ ssid: "Reef WiFi", bssid: "aa:bb:cc:dd:ee:ff" });
    expect(parseIwLink("Not connected.\n")).toBeUndefined();
  });

  it("parses NetworkManager output used by production controllers", () => {
    expect(parseNmcliWifiDevice("wlan0:wifi:connected\neth0:ethernet:unavailable\n"))
      .toBe("wlan0");
    expect(parseNmcliActiveAccessPoint("*:ERROR-404:30\\:34\\:22\\:EB\\:38\\:66\n"))
      .toEqual({ ssid: "ERROR-404", bssid: "30:34:22:eb:38:66" });
  });
});
