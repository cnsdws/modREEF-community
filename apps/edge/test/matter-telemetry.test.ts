import { describe, expect, it } from "vitest";

import {
  matterMilliwattHoursToKilowattHours,
  matterMilliwattsToWatts,
  readMatterChannelState,
} from "../src/matter-controller.js";

describe("Matter electrical telemetry units", () => {
  it("converts active power from milliwatts to watts", () => {
    expect(matterMilliwattsToWatts(42_500)).toBe(42.5);
    expect(matterMilliwattsToWatts(1_250n)).toBe(1.25);
    expect(matterMilliwattsToWatts(null)).toBeUndefined();
  });

  it("converts cumulative energy from milliwatt-hours to kWh", () => {
    expect(matterMilliwattHoursToKilowattHours(12_345_000)).toBe(12.345);
    expect(matterMilliwattHoursToKilowattHours(500_000n)).toBe(0.5);
    expect(matterMilliwattHoursToKilowattHours(undefined)).toBeUndefined();
  });

  it("reads relay, power, and energy concurrently", async () => {
    const pending: Array<() => void> = [];
    const wait = <T>(value: T) => new Promise<T>((resolve) => {
      pending.push(() => resolve(value));
    });
    const endpoint = {
      getClusterClientById(clusterId: never) {
        if (Number(clusterId) === 6) {
          return { getOnOffAttribute: () => wait(true) };
        }
        if (Number(clusterId) === 0x0090) {
          return { getActivePowerAttribute: () => wait(42_500) };
        }
        if (Number(clusterId) === 0x0091) {
          return {
            getCumulativeEnergyImportedAttribute: () =>
              wait({ energy: 12_345_000 }),
          };
        }
        return undefined;
      },
    };

    const statePromise = readMatterChannelState(endpoint);
    await Promise.resolve();
    expect(pending).toHaveLength(3);
    pending.forEach((resolve) => resolve());
    await expect(statePromise).resolves.toEqual({
      relayOn: true,
      watts: 42.5,
      energyKwh: 12.345,
    });
  });
});
