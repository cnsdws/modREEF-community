import type { DiscoveredDevice } from "@modreef/discovery";
import {
  fingerprintDevice,
  type DeviceIdentity,
} from "@modreef/identity";
import {
  qualificationForIdentity,
  type DeviceQualification,
} from "@modreef/qualification";
import { probeTuya } from "@modreef/protocol-tuya";

import type { DeviceInspection } from "./index.js";

export async function inspectDevice(
  device: DiscoveredDevice,
): Promise<DeviceInspection> {
  const identity: DeviceIdentity = fingerprintDevice(device);

  const qualification: DeviceQualification | null =
    identity.confidence > 0
      ? qualificationForIdentity(identity)
      : null;

  const tuya =
    device.ipAddress
      ? await probeTuya(device.ipAddress)
      : null;

  return {
    id: device.id,
    sections: [
      {
        title: "Discovery",
        entries: {
          id: device.id,
          displayName: device.displayName,
          ipAddress: device.ipAddress,
          macAddress: device.macAddress,
          protocols: device.protocols,
          services: device.services,
          interfaces: device.interfaces,
        },
      },
      {
        title: "Identity",
        entries: { ...identity },
      },
      {
        title: "Qualification",
        entries: qualification ? { ...qualification } : {},
      },
      {
        title: "Protocols",
        entries: {
          tuya,
        },
      },
    ],
  };
}
