import { describe, expect, it } from "vitest";
import { JebaoMd44Driver } from "../src/driver.js";
import type { JebaoMd44RawStatus } from "../src/protocol.js";
import type { TcpJebaoMd44Transport } from "../src/transport.js";

function status(activeBitmap: number): JebaoMd44RawStatus {
  const payload = Buffer.alloc(3);
  payload[2] = activeBitmap;
  return { messageType: 0x91, action: 3, payload, frame: Buffer.alloc(0) };
}

describe("JebaoMd44Driver", () => {
  it("reports native scheduled head activity from each live status read", async () => {
    let currentStatus = status(0);
    const transport = {
      connect: async () => undefined,
      readRawStatus: async () => currentStatus,
    } as unknown as TcpJebaoMd44Transport;
    const driver = new JebaoMd44Driver("md44-test", transport);

    await driver.connect("md44-test");
    currentStatus = status((1 << 2) | (1 << 4));
    const running = await driver.getState("md44-test");

    expect(running.channels["head-1"]?.relayOn).toBe(false);
    expect(running.channels["head-2"]?.relayOn).toBe(true);
    expect(running.channels["head-3"]?.relayOn).toBe(false);
    expect(running.channels["head-4"]?.relayOn).toBe(true);
  });
});
