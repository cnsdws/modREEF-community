import type { OnboardingCandidate } from "@modreef/onboarding";

import {
  tuyaDiscoveredDeviceMarker,
  tuyaWaterDeviceMarker,
  yinmikWaterProductId,
} from "./tuyaIdentityConstants";

export function isYinmikWaterCandidate(candidate: OnboardingCandidate): boolean {
  return candidate.displayName.startsWith("Water Meter") ||
    candidate.manufacturerData === yinmikWaterProductId ||
    candidate.serviceUuids.includes(tuyaWaterDeviceMarker);
}

/**
 * A Tuya Wi-Fi scan sees the same device twice: first as a raw FD50 BLE
 * advertisement, then as the SDK's provisionable candidate. Prefer one SDK
 * record for each matching raw record without collapsing two physical devices
 * that happen to share a product ID.
 */
export function deduplicateTuyaCandidates(
  candidates: readonly OnboardingCandidate[],
): OnboardingCandidate[] {
  const sdkCounts = new Map<string, number>();
  for (const candidate of candidates) {
    if (
      candidate.manufacturerData &&
      candidate.serviceUuids.includes(tuyaDiscoveredDeviceMarker) &&
      !candidate.serviceUuids.includes("FD50")
    ) {
      sdkCounts.set(
        candidate.manufacturerData,
        (sdkCounts.get(candidate.manufacturerData) ?? 0) + 1,
      );
    }
  }

  return candidates.filter((candidate) => {
    const productId = candidate.manufacturerData;
    if (!productId || !candidate.serviceUuids.includes("FD50")) return true;
    const remaining = sdkCounts.get(productId) ?? 0;
    if (remaining === 0) return true;
    sdkCounts.set(productId, remaining - 1);
    return false;
  });
}
