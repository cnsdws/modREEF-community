import { describe, expect, it } from "vitest";

import { fingerprintDevice } from "../src/index.js";

describe("fingerprintDevice", () => {
  it("identifies a Philips Hue Bridge", () => {
    expect(
      fingerprintDevice({
        id: "1",
        protocols: ["mdns"],
        services: ["_hue._tcp"],
        metadata: {},
      }),
    ).toEqual({
      manufacturer: "Philips",
      model: "Hue Bridge",
      deviceClass: "lighting-controller",
      confidence: 1.0,
    });
  });

  it("returns unknown for unrecognized devices", () => {
    expect(
      fingerprintDevice({
        id: "1",
        protocols: ["mdns"],
        services: ["_http._tcp"],
        metadata: {},
      }),
    ).toEqual({
      confidence: 0,
    });
  });
});
