import { describe, expect, it, vi } from "vitest";

import {
  prepareDeviceOnboarding,
  soleControllerForDeviceAdministration,
} from "../src/deviceOnboardingAuthorization";

const controller = { id: "edge-1", name: "Development Reef Controller" };

describe("device onboarding authorization", () => {
  it("defaults device administration to the only controller", () => {
    expect(soleControllerForDeviceAdministration([controller], null)).toBe(controller);
    expect(soleControllerForDeviceAdministration([controller], controller.id)).toBeUndefined();
  });

  it("requires an explicit selection when multiple controllers exist", () => {
    expect(soleControllerForDeviceAdministration([
      controller,
      { id: "edge-2", name: "Second Reef Controller" },
    ], null)).toBeUndefined();
  });

  it("revalidates the selected controller before device discovery", async () => {
    const selectController = vi.fn().mockResolvedValue(true);

    await prepareDeviceOnboarding(controller, selectController);

    expect(selectController).toHaveBeenCalledWith(controller);
  });

  it("stops when controller authorization cannot be refreshed", async () => {
    await expect(
      prepareDeviceOnboarding(controller, vi.fn().mockResolvedValue(false)),
    ).rejects.toThrow("Could not authorize Development Reef Controller");
  });

  it("stops when no controller is selected", async () => {
    await expect(
      prepareDeviceOnboarding(undefined, vi.fn()),
    ).rejects.toThrow("Choose a Reef Controller");
  });
});
