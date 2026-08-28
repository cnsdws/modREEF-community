import { describe, expect, it } from "vitest";

import { inspectDevice } from "../src/deviceInspector.js";

describe("inspectDevice", () => {
  it("builds a workbench inspection", async () => {
    const inspection = await inspectDevice({
      id: "device-1",
      protocols: ["mdns"],
      displayName: "Hue Bridge",
      services: ["_hue._tcp"],
      metadata: {},
    });

    expect(inspection.sections.map((section) => section.title)).toEqual([
      "Discovery",
      "Identity",
      "Qualification",
      "Protocols",
    ]);

    expect(inspection.sections[1]?.entries).toMatchObject({
      manufacturer: "Philips",
      model: "Hue Bridge",
      confidence: 1,
    });
  });
});
