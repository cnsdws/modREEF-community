import { describe, expect, it } from "vitest";
import type { OnboardingCandidate } from "@modreef/onboarding";

import {
  tuyaDiscoveredDeviceMarker,
  tuyaWaterDeviceMarker,
  yinmikWaterProductId,
} from "../src/bleTransport";
import {
  deduplicateTuyaCandidates,
  isYinmikWaterCandidate,
} from "../src/tuyaCandidateIdentity";

function candidate(overrides: Partial<OnboardingCandidate>): OnboardingCandidate {
  return {
    id: "candidate",
    transport: "bluetooth-le",
    displayName: "Nearby Tuya device",
    serviceUuids: [tuyaDiscoveredDeviceMarker],
    ...overrides,
  };
}

describe("isYinmikWaterCandidate", () => {
  it("does not mistake a generic Tuya commissioning result for a water sensor", () => {
    expect(isYinmikWaterCandidate(candidate({ manufacturerData: "ghome-product" })))
      .toBe(false);
  });

  it("recognizes the known YINMIK product", () => {
    expect(isYinmikWaterCandidate(candidate({ manufacturerData: yinmikWaterProductId })))
      .toBe(true);
  });

  it("retains water identity for an owned sensor with an alternate product id", () => {
    expect(isYinmikWaterCandidate(candidate({
      manufacturerData: "alternate-water-product",
      serviceUuids: [tuyaDiscoveredDeviceMarker, tuyaWaterDeviceMarker],
    }))).toBe(true);
  });

  it("retains the scanner's explicit water-meter identity", () => {
    expect(isYinmikWaterCandidate(candidate({
      displayName: "Water Meter · Already on Wi-Fi",
      manufacturerData: "alternate-product-id",
    }))).toBe(true);
  });
});

describe("deduplicateTuyaCandidates", () => {
  it("prefers the provisionable SDK record over the matching raw advertisement", () => {
    const raw = candidate({
      id: "raw",
      displayName: "Nearby device",
      manufacturerData: "outlet-product",
      serviceUuids: [tuyaDiscoveredDeviceMarker, "FD50"],
    });
    const sdk = candidate({
      id: "sdk",
      displayName: "Outlet",
      manufacturerData: "outlet-product",
    });

    expect(deduplicateTuyaCandidates([raw, sdk])).toEqual([sdk]);
  });

  it("does not collapse two SDK devices with the same product ID", () => {
    const first = candidate({ id: "sdk-one", manufacturerData: "same-product" });
    const second = candidate({ id: "sdk-two", manufacturerData: "same-product" });

    expect(deduplicateTuyaCandidates([first, second])).toEqual([first, second]);
  });
});
