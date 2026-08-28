import type { DiscoveredDevice } from "@modreef/discovery";

import { EeroRule } from "./eeroRule.js";
import { HueRule } from "./hueRule.js";
import { DeviceIdentityEngine } from "./identityEngine.js";

export interface DeviceIdentity {
  manufacturer?: string;
  model?: string;
  deviceClass?: string;
  confidence: number;
}

const defaultEngine = new DeviceIdentityEngine([
  new HueRule(),
  new EeroRule(),
]);

export function fingerprintDevice(
  device: DiscoveredDevice,
): DeviceIdentity {
  return defaultEngine.identify(device);
}

export { DeviceIdentityEngine } from "./identityEngine.js";
export type { DeviceIdentityRule } from "./rules.js";
