import { describe, expect, it } from "vitest";
import { mapGHomeWp12State } from "../src/state.js";

describe("mapGHomeWp12State", () => {
  it("maps WP12 DPS without leaking DPS keys", () => {
    const state = mapGHomeWp12State("wp12-1", {
      "1": true,
      "2": false,
      "7": true,
      "20": 1215,
      "38": "unknown",
    });

    expect(state.channels["outlet-1"]?.relayOn).toBe(true);
    expect(state.channels["outlet-2"]?.relayOn).toBe(false);
    expect(state.channels.usb?.relayOn).toBe(true);
    expect(state.channels.mains?.volts).toBe(121.5);
    expect(state.channels).not.toHaveProperty("38");
  });
});
