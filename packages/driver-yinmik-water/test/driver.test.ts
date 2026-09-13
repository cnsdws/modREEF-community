import { describe, expect, it } from "vitest";

import {
  YinmikWaterDriver,
  type YinmikWaterCredentials,
  type YinmikWaterTransport,
} from "../src/driver.js";

describe("YinmikWaterDriver", () => {
  it("maps one DPS read into the standard aggregate sensor state", async () => {
    const driver = new YinmikWaterDriver(registration(), {
      createTransport: () => transport({ "2": 218, "10": 803, "11": 49448, "12": 188 }),
    });
    await driver.connect("water-1");
    const state = await driver.getState("water-1");
    expect(state.channels["water-quality"]?.measurements).toMatchObject({
      temperature: { value: 71.24, unit: "°F" },
      ph: { value: 8.03, unit: "" },
      orp: { value: 188, unit: "mV" },
      salinity: { unit: "ppt" },
    });
  });

  it("recovers through the bounded Tuya protocol list and persists the winner", async () => {
    const attempted: string[] = [];
    let persisted: YinmikWaterCredentials | undefined;
    const driver = new YinmikWaterDriver(registration(), {
      createTransport: (credentials) => {
        attempted.push(credentials.protocolVersion ?? "initial");
        return credentials.protocolVersion === "3.5"
          ? transport({ "10": 810 })
          : { readStatus: async () => { throw new Error("wrong protocol"); } };
      },
      resolveNetworkAddress: async () => "10.0.0.44",
      persistCredentials: (credentials) => { persisted = credentials; },
    });

    const readings = await driver.readMeasurements("reef");
    expect(readings.find(({ parameter }) => parameter === "ph")?.value).toBe(8.1);
    expect(attempted).toEqual(["3.4", "3.4", "3.5"]);
    expect(persisted).toMatchObject({
      networkAddress: "10.0.0.44",
      protocolVersion: "3.5",
    });
  });
});

function registration() {
  return {
    deviceId: "water-1",
    displayName: "Water Meter",
    credentials: {
      deviceId: "water-1",
      networkAddress: "10.0.0.44",
      localKey: "fixture-only",
      productId: "u5xgcpcngk3pfxb4",
      protocolVersion: "3.4" as const,
    },
  };
}

function transport(dps: Record<string, unknown>): YinmikWaterTransport {
  return { readStatus: async () => dps };
}
