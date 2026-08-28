import { describe, expect, it } from "vitest";
import { createMdpAirLinkPlan } from "../src/airlink.js";

describe("MDP Smart Wi-Fi AirLink", () => {
  it("generates the capture-confirmed ESPTouch guide sequence", () => {
    const plan = createMdpAirLinkPlan({
      ssid: "ReefLab",
      password: "safe-fixture-password",
      bssid: "02:00:00:00:00:01",
      localAddress: "192.168.4.20",
    });
    expect(plan.guidePacketLengths).toEqual([515, 514, 513, 512]);
    expect(plan.dataPacketLengths.length % 3).toBe(0);
    expect(plan.dataPacketLengths.every((length) => length >= 40 && length <= 423)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("safe-fixture-password");
    expect(JSON.stringify(plan)).not.toContain("ReefLab");
  });

  it("rejects invalid network data before transmitting", () => {
    expect(() => createMdpAirLinkPlan({
      ssid: "ReefLab",
      password: "short",
      bssid: "not-a-mac",
      localAddress: "192.168.4.20",
    })).toThrow("BSSID");
  });
});
