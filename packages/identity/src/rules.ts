import type { DiscoveredDevice } from "@modreef/discovery";

import type { DeviceIdentity } from "./index.js";

export interface DeviceIdentityRule {
  readonly id: string;

  identify(device: DiscoveredDevice): DeviceIdentity | null;
}
