import type { DiscoveredDevice } from "@modreef/discovery";

import type { DeviceIdentity } from "./index.js";
import type { DeviceIdentityRule } from "./rules.js";

export class EeroRule implements DeviceIdentityRule {
  readonly id = "eero-router";

  identify(device: DiscoveredDevice): DeviceIdentity | null {
    if (!(device.services ?? []).includes("_eero._tcp")) {
      return null;
    }

    return {
      manufacturer: "Eero",
      model: "Eero Router",
      deviceClass: "network-router",
      confidence: 0.95,
    };
  }
}
