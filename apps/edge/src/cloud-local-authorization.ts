import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { EdgeCloudConfig } from "./cloud-sync.js";

interface LocalAuthorizationPayload {
  edgeId: string;
  aquariumId: string;
  expiresAtMs: number;
  nonce: string;
}

export function verifyCloudLocalAuthorization(
  grant: string,
  config: EdgeCloudConfig,
  now = Date.now(),
): LocalAuthorizationPayload | null {
  const [encodedPayload, encodedSignature, extra] = grant.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  const deviceTokenHash = createHash("sha256").update(config.token).digest("hex");
  const expected = createHmac("sha256", deviceTokenHash)
    .update(encodedPayload)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<LocalAuthorizationPayload>;
    if (
      payload.edgeId !== config.edgeId ||
      payload.aquariumId !== config.aquariumId ||
      typeof payload.expiresAtMs !== "number" ||
      payload.expiresAtMs <= now ||
      payload.expiresAtMs > now + 90_000 ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 16
    ) return null;
    return payload as LocalAuthorizationPayload;
  } catch {
    return null;
  }
}
