import { describe, expect, it } from "vitest";

import { createInitialTwin } from "../src/initial-twin.js";

describe("factory Reef Controller state", () => {
  it("starts without simulated equipment or physical devices", () => {
    const twin = createInitialTwin("2026-07-29T00:00:00.000Z");

    expect(twin.equipment).toEqual([]);
    expect(twin.devices).toBeUndefined();
    expect(twin.measurements).toEqual([]);
  });
});
