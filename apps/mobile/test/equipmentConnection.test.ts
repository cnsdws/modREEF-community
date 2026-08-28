import { describe, expect, it } from "vitest";

import { equipmentConnectionLabel } from "../src/equipmentConnection";

describe("equipmentConnectionLabel", () => {
  it.each([
    ["outlet-1", "Outlet 1"],
    ["outlet-6", "Outlet 6"],
    ["usb", "USB Power"],
    ["usb-2", "USB 2"],
    [undefined, "Device-level"],
  ])("formats %s as %s", (channelId, expected) => {
    expect(equipmentConnectionLabel(channelId)).toBe(expected);
  });

  it("preserves an unfamiliar physical channel identifier", () => {
    expect(equipmentConnectionLabel("relay-a")).toBe("relay-a");
  });
});
