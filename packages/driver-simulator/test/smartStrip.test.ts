import { describe, expect, it } from "vitest";
import { SimulatedSmartStripDriver } from "../src/index";

describe("SimulatedSmartStripDriver", () => {
  it("discovers a six-outlet device", async () => {
    const driver = new SimulatedSmartStripDriver();
    const devices = await driver.discover();

    expect(devices).toHaveLength(1);
    expect(devices[0]?.channels).toHaveLength(6);
    expect(devices[0]?.protocol).toBe("simulator");
  });

  it("controls an outlet and reports updated state", async () => {
    const driver = new SimulatedSmartStripDriver();

    await driver.connect("simulated-smart-strip");

    const result = await driver.execute({
      type: "set-relay",
      deviceId: "simulated-smart-strip",
      channelId: "outlet-1",
      on: true,
    });

    expect(result.accepted).toBe(true);
    expect(
      result.resultingState?.channels["outlet-1"]?.relayOn,
    ).toBe(true);

    expect(
      result.resultingState?.channels["outlet-1"]?.watts,
    ).toBe(42);
  });

  it("stores a device-resident schedule", async () => {
    const driver = new SimulatedSmartStripDriver();

    await driver.connect("simulated-smart-strip");

    await driver.execute({
      type: "replace-schedule",
      deviceId: "simulated-smart-strip",
      events: [
        {
          id: "skimmer-on",
          channelId: "outlet-2",
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          time: "08:00",
          relayOn: true,
        },
      ],
    });

    expect(driver.getInstalledSchedule()).toHaveLength(1);
  });

  it("rejects commands while disconnected", async () => {
    const driver = new SimulatedSmartStripDriver();

    await expect(
      driver.execute({
        type: "set-relay",
        deviceId: "simulated-smart-strip",
        channelId: "outlet-1",
        on: true,
      }),
    ).rejects.toThrow("Device is not connected");
  });
});
