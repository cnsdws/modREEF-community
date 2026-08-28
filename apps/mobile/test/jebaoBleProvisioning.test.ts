import { describe, expect, it } from "vitest";

import {
  buildJebaoBleWifiFrame,
  chunkJebaoBleWifiFrame,
  isJebaoBleAdvertisement,
  isJebaoDmpBleAdvertisement,
} from "../src/jebaoBleProvisioning";

describe("Jebao GizWits BLE provisioning", () => {
  it("recognizes the MD-4.4 setup advertisement", () => {
    expect(isJebaoBleAdvertisement({ name: "Jebao_WiFi-f7e0" })).toBe(true);
    expect(isJebaoBleAdvertisement({ serviceUuids: ["0000abf0-0000-1000-8000-00805f9b34fb"] })).toBe(true);
  });

  it("recognizes a DMP-series wavemaker without treating arbitrary names as Jebao", () => {
    expect(isJebaoDmpBleAdvertisement({ name: "W_CE32B4" })).toBe(true);
    expect(isJebaoDmpBleAdvertisement({ name: "XPG-GAgent-32b4" })).toBe(true);
    expect(isJebaoDmpBleAdvertisement({ serviceUuids: ["F0AB"] })).toBe(true);
    expect(isJebaoDmpBleAdvertisement({ name: "Jebao_WiFi-f7e0" })).toBe(false);
    expect(isJebaoDmpBleAdvertisement({ name: "W_NOTDMP" })).toBe(false);
  });

  it("builds the GizWits BLE Wi-Fi frame", () => {
    expect(buildJebaoBleWifiFrame("reef", "password")).toEqual([
      0, 0, 0, 3, 19, 0, 0, 1, 0, 4,
      114, 101, 101, 102,
      0, 8,
      112, 97, 115, 115, 119, 111, 114, 100,
    ]);
  });

  it("splits frames into the SDK's 20-byte writes", () => {
    const frame = buildJebaoBleWifiFrame("reef", "password");
    expect(chunkJebaoBleWifiFrame(frame).map((chunk) => chunk.length)).toEqual([20, 4]);
  });
});
