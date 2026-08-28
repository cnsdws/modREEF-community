import { createHash, timingSafeEqual } from "node:crypto";

/** Verifies a scanned physical-possession credential without timing leakage. */
export function controllerClaimSecretMatches(
  expectedHash: string | undefined,
  claimSecret: string | undefined,
): boolean {
  if (!expectedHash) return true;
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !claimSecret || !/^[A-Za-z0-9_-]{43}$/.test(claimSecret)) {
    return false;
  }
  const actual = createHash("sha256").update(claimSecret).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
