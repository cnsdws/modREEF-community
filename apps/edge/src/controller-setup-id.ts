import { createHash } from "node:crypto";

export interface ControllerSetupIdInputs {
  factorySetupId?: unknown;
  physicalSerial?: string | undefined;
  fallbackIdentity: string;
}

/** Selects a stable, human-visible controller identifier without weakening factory identity. */
export function deriveControllerSetupId(inputs: ControllerSetupIdInputs): string {
  if (typeof inputs.factorySetupId === "string" && /^[A-F0-9]{6}$/.test(inputs.factorySetupId)) {
    return inputs.factorySetupId;
  }
  const physicalSerial = inputs.physicalSerial?.replaceAll("\0", "").trim().toLowerCase();
  if (physicalSerial && /^[a-f0-9]{8,64}$/.test(physicalSerial)) {
    return physicalSerial.slice(-6).toUpperCase();
  }
  return createHash("sha256").update(inputs.fallbackIdentity).digest("hex").slice(0, 6).toUpperCase();
}
