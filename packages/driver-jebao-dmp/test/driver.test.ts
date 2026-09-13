import { describe, expect, it } from "vitest";

import {
  JebaoDmpDriver,
  type DmpController,
} from "../src/driver.js";

describe("JebaoDmpDriver", () => {
  it("connects, confirms power and mode commands, and exposes standard state", async () => {
    const calls: string[] = [];
    const controller: DmpController = {
      connect: async () => { calls.push("connect"); },
      disconnect: async () => { calls.push("disconnect"); },
      setPower: async (on) => { calls.push(`power:${on}`); },
      setMode: async (mode, speed, frequency) => {
        calls.push(`mode:${mode}:${speed}:${frequency}`);
      },
    };
    const driver = new JebaoDmpDriver({
      deviceId: "dmp-ce32b4",
      displayName: "Wavemaker",
      advertisedName: "W_CE32B4",
      bluetoothAddress: "AA:BB:CC:DD:EE:FF",
    }, () => controller);

    await driver.connect("dmp-ce32b4");
    const power = await driver.setPower(true);
    const mode = await driver.setMode("M2", 65, 35);
    await driver.disconnect("dmp-ce32b4");

    expect(calls).toEqual([
      "connect",
      "power:true",
      "mode:M2:65:35",
      "disconnect",
    ]);
    expect(power.resultingState?.channels.pump?.relayOn).toBe(true);
    expect(mode.resultingState?.channels.pump?.speedPercent).toBe(65);
  });
});
