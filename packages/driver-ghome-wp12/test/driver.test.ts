import { describe, expect, it } from "vitest";
import { GHomeWp12Driver } from "../src/index.js";
import type {
  GHomeWp12Transport,
  TuyaDps,
} from "../src/transport.js";

class FakeTransport implements GHomeWp12Transport {
  readonly values: TuyaDps = {
    "1": false,
    "2": false,
    "3": false,
    "4": false,
    "5": false,
    "6": false,
    "7": false,
    "20": 1200,
  };

  async readStatus(): Promise<TuyaDps> {
    return { ...this.values };
  }

  async setValue(dps: number, value: boolean): Promise<void> {
    this.values[String(dps)] = value;
  }

  async setValues(values: TuyaDps): Promise<void> {
    Object.assign(this.values, values);
  }
}

describe("GHomeWp12Driver", () => {
  it("supports a device-scoped driver identity", () => {
    const driver = new GHomeWp12Driver(
      "wp12-2",
      new FakeTransport(),
      "modreef.ghome.wp12:wp12-2",
    );
    expect(driver.id).toBe("modreef.ghome.wp12:wp12-2");
  });

  it("controls an outlet through the HAL", async () => {
    const transport = new FakeTransport();
    const driver = new GHomeWp12Driver("wp12-1", transport);

    await driver.connect("wp12-1");

    const result = await driver.execute({
      type: "set-relay",
      deviceId: "wp12-1",
      channelId: "outlet-1",
      on: true,
    });

    expect(transport.values["1"]).toBe(true);
    expect(
      result.resultingState?.channels["outlet-1"]?.relayOn,
    ).toBe(true);
  });

  it("maps USB power to DPS 7 internally", async () => {
    const transport = new FakeTransport();
    const driver = new GHomeWp12Driver("wp12-1", transport);

    await driver.connect("wp12-1");

    await driver.execute({
      type: "set-relay",
      deviceId: "wp12-1",
      channelId: "usb",
      on: true,
    });

    expect(transport.values["7"]).toBe(true);
  });
});
