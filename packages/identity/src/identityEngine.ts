import type { DiscoveredDevice } from "@modreef/discovery";

import type { DeviceIdentity } from "./index.js";
import type { DeviceIdentityRule } from "./rules.js";

export class DeviceIdentityEngine {
  constructor(
    private readonly rules: DeviceIdentityRule[],
  ) {}

  identify(device: DiscoveredDevice): DeviceIdentity {
    for (const rule of this.rules) {
      const identity = rule.identify(device);

      if (identity) {
        return identity;
      }
    }

    return {
      confidence: 0,
    };
  }
}
