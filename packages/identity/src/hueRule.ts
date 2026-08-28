import type { DiscoveredDevice } from "@modreef/discovery";

import type { DeviceIdentity } from "./index.js";
import type { DeviceIdentityRule } from "./rules.js";

export class HueRule implements DeviceIdentityRule {
  readonly id = "philips-hue";

  identify(device: DiscoveredDevice): DeviceIdentity | null {
    if (!(device.services ?? []).includes("_hue._tcp")) {
      return null;
    }

    return {
      manufacturer: "Philips",
      model: "Hue Bridge",
      deviceClass: "lighting-controller",
      confidence: 1,
    };
  }
}
