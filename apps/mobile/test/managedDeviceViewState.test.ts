import { describe, expect, it } from "vitest";

import { managedDeviceViewState } from "../src/managedDeviceViewState.js";

describe("managed device view state", () => {
  it("does not show an empty state while loading", () => {
    expect(managedDeviceViewState(true, null, 0, true).kind).toBe("loading");
  });

  it("does not show an empty state when local authorization is missing", () => {
    expect(managedDeviceViewState(
      false,
      "Reef Controller authorization expired; select the controller again",
      0,
      true,
    )).toEqual({
      kind: "error",
      message:
        "Devices remain available through cloud control. Local device administration is unavailable on this device.",
    });
  });

  it("shows empty only after a successful zero-device response", () => {
    expect(managedDeviceViewState(false, null, 0, false)).toEqual({
      kind: "empty",
      message: "No devices have been added to this Reef Controller.",
    });
  });

  it("shows devices after a successful response", () => {
    expect(managedDeviceViewState(false, null, 2, true)).toEqual({
      kind: "ready",
    });
  });
});
