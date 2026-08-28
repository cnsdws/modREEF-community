import type { OnboardingCandidate } from "@modreef/onboarding";

export function shouldOfferManualSetupCode(
  candidates: OnboardingCandidate[],
): boolean {
  return candidates.length === 0;
}
