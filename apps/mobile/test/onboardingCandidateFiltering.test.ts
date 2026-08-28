import { describe, expect, it } from "vitest";

import {
  isRegisteredDmpCandidate,
  isRegisteredOnboardingCandidate,
} from "../src/onboardingCandidateFiltering";

describe("isRegisteredDmpCandidate", () => {
  it("filters a registered wavemaker by its stable controller suffix", () => {
    expect(isRegisteredDmpCandidate({
      id: "edge-dmp:C6:C0:1E:CE:32:B4",
      transport: "bluetooth-le",
      displayName: "XPG-GAgent-32b4",
      serviceUuids: [],
    }, [{ id: "dmp-ce32b4" }])).toBe(true);
  });

  it("does not hide a different wavemaker", () => {
    expect(isRegisteredDmpCandidate({
      id: "edge-dmp:C6:C0:1E:AA:11:22",
      transport: "bluetooth-le",
      displayName: "XPG-GAgent-1122",
      serviceUuids: [],
    }, [{ id: "dmp-ce32b4" }])).toBe(false);
  });
});

describe("isRegisteredOnboardingCandidate", () => {
  const candidate = {
    id: "tuya-commissioning-uuid",
    transport: "bluetooth-le" as const,
    displayName: "YINMIK Water Quality Monitor",
    serviceUuids: [],
  };

  it("filters a device previously commissioned by modREEF", () => {
    expect(isRegisteredOnboardingCandidate(candidate, [{
      deviceId: "tuya-cloud-device-id",
      commissioningId: "tuya-commissioning-uuid",
    }])).toBe(true);
  });

  it("does not filter a device merely because Tuya reports it active", () => {
    expect(isRegisteredOnboardingCandidate(candidate, [{
      deviceId: "another-device",
      commissioningId: "another-commissioning-uuid",
    }])).toBe(false);
  });
});
