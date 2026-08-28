export const biometricBackgroundGraceMilliseconds = 5 * 60 * 1_000;

export function shouldLockAfterBackground(
  backgroundedAt: number | null,
  resumedAt: number,
  graceMilliseconds = biometricBackgroundGraceMilliseconds,
): boolean {
  return backgroundedAt !== null && resumedAt - backgroundedAt >= graceMilliseconds;
}
