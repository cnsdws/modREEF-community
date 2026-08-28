import type { DeviceIdentity } from "@modreef/identity";

import type { DeviceQualification } from "./index.js";
import { ghomeWp12Qualification } from "./ghomeWp12.js";

export function qualificationForIdentity(
  identity: DeviceIdentity,
): DeviceQualification | null {
  if (
    identity.manufacturer === "GHome" &&
    identity.model === "WP12"
  ) {
    return ghomeWp12Qualification;
  }

  return null;
}
