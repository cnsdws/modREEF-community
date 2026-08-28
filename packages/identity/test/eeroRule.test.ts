import { describe, expect, it } from "vitest";

import { EeroRule } from "../src/eeroRule.js";

describe("EeroRule", () => {
  it("identifies an Eero router", () => {
    const rule = new EeroRule();

    expect(
      rule.identify({
        id: "1",
        protocols: ["mdns"],
        services: ["_eero._tcp"],
        metadata: {},
      }),
    ).toEqual({
      manufacturer: "Eero",
      model: "Eero Router",
      deviceClass: "network-router",
      confidence: 0.95,
    });
  });

  it("returns null for non-Eero devices", () => {
    const rule = new EeroRule();

    expect(
      rule.identify({
        id: "1",
        protocols: ["mdns"],
        services: ["_http._tcp"],
        metadata: {},
      }),
    ).toBeNull();
  });
});
