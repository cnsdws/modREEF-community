import { describe, expect, it } from "vitest";

import type { OnboardingCandidate } from "@modreef/onboarding";

import { shouldOfferManualSetupCode } from "../src/onboardingChoices";

const tuyaCandidate: OnboardingCandidate = {
  id: "tuya-strip",
  transport: "bluetooth-le",
  displayName: "Smart Power Strip",
  manufacturerData: "tuya-product-id",
  serviceUuids: [],
};

const tapoCandidate: OnboardingCandidate = {
  id: "matter:tapo-strip",
  transport: "bluetooth-le",
  displayName: "Nearby Tapo device",
  manufacturerData: "matter-tapo-known-address",
  serviceUuids: ["8641"],
};

describe("onboarding choices", () => {
  it("does not show a second setup-code path after finding a Tuya device", () => {
    expect(shouldOfferManualSetupCode([tuyaCandidate])).toBe(false);
  });

  it("does not show a second setup-code path after finding a Tapo device", () => {
    expect(shouldOfferManualSetupCode([tapoCandidate])).toBe(false);
  });

  it("offers setup-code entry only when discovery finds nothing", () => {
    expect(shouldOfferManualSetupCode([])).toBe(true);
  });
});
