import { describe, expect, it } from "vitest";

import { HueRule } from "../src/hueRule.js";
import { DeviceIdentityEngine } from "../src/identityEngine.js";

describe("DeviceIdentityEngine", () => {
  it("uses the first matching rule", () => {
    const engine = new DeviceIdentityEngine([
      new HueRule(),
    ]);

    expect(
      engine.identify({
        id: "1",
        protocols: ["mdns"],
        services: ["_hue._tcp"],
        metadata: {},
      }),
    ).toEqual({
      manufacturer: "Philips",
      model: "Hue Bridge",
      deviceClass: "lighting-controller",
      confidence: 1,
    });
  });

  it("returns unknown when no rule matches", () => {
    const engine = new DeviceIdentityEngine([]);

    expect(
      engine.identify({
        id: "1",
        protocols: ["mdns"],
        metadata: {},
      }),
    ).toEqual({
      confidence: 0,
    });
  });
});
