import type { OnboardingCandidate } from "@modreef/onboarding";

export interface RegisteredPhysicalDevice {
  id: string;
}

export interface RegisteredOnboardingDevice {
  deviceId: string;
  commissioningId?: string;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isRegisteredDmpCandidate(
  candidate: OnboardingCandidate,
  devices: readonly RegisteredPhysicalDevice[],
): boolean {
  const identity = compact(`${candidate.id} ${candidate.displayName}`);
  return devices.some(({ id }) => {
    if (!id.toLowerCase().startsWith("dmp-")) return false;
    const suffix = compact(id.slice(4));
    return suffix.length >= 6 && identity.includes(suffix);
  });
}

export function isRegisteredOnboardingCandidate(
  candidate: OnboardingCandidate,
  devices: readonly RegisteredOnboardingDevice[],
): boolean {
  return devices.some(({ commissioningId, deviceId }) =>
    candidate.id === commissioningId || candidate.id === deviceId
  );
}
