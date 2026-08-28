import type { DeviceDescriptor } from "@modreef/hal";

const relayCapability = {
  kind: "relay" as const,
  executionLocation: "device" as const,
  internetRequired: false,
  reportsState: true,
  supportsAutoOff: true,
  minimumAutoOffSeconds: 1,
  maximumAutoOffSeconds: 86_400,
};

const countdownCapability = {
  kind: "countdown" as const,
  executionLocation: "device" as const,
  internetRequired: false,
  minimumSeconds: 1,
  maximumSeconds: 86_400,
  runsWithoutApp: true,
};

export function createGHomeWp12Descriptor(
  deviceId: string,
): DeviceDescriptor {
  return {
    id: deviceId,
    driverId: "modreef.ghome.wp12",
    manufacturer: "GHome",
    model: "WP12",
    displayName: "GHome WP12 Smart Power Strip",
    protocol: "tuya-wifi",
    channels: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `outlet-${index + 1}`,
        name: `Outlet ${index + 1}`,
        channelNumber: index + 1,
        capabilities: [relayCapability, countdownCapability],
      })),
      {
        id: "usb",
        name: "USB Power",
        channelNumber: 7,
        capabilities: [relayCapability, countdownCapability],
      },
      {
        id: "mains",
        name: "Mains",
        capabilities: [
          {
            kind: "power-monitoring",
            executionLocation: "device",
            internetRequired: false,
            reportsWatts: false,
            reportsVolts: true,
            reportsAmps: false,
            perChannel: false,
          },
        ],
      },
    ],
  };
}
