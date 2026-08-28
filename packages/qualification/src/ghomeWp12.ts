import type { DeviceQualification } from "./index.js";

export const ghomeWp12Qualification: DeviceQualification = {
  status: "verified",
  capabilities: [
    {
      id: "switch.outlet",
      supported: true,
      details: {
        count: 6,
        individuallyControllable: true,
        localControl: true,
      },
    },
    {
      id: "usb.power",
      supported: true,
      details: {
        switchedAsGroup: true,
        localControl: true,
      },
    },
    {
      id: "power.monitoring",
      supported: true,
      details: {
        reportsVolts: true,
        reportsWatts: false,
        reportsAmps: false,
        scope: "device",
      },
    },
    {
      id: "schedule",
      supported: false,
      details: {
        reason: "Not implemented by the current driver",
      },
    },
    {
      id: "wifi.2_4ghz",
      supported: true,
    },
    {
      id: "bluetooth.provisioning",
      supported: true,
      details: {
        implementation: "Official Tuya iOS SDK",
        cloudRequiredDuringProvisioning: true,
      },
    },
    {
      id: "protocol.tuya-lan",
      supported: true,
      details: {
        version: "3.5",
        cloudRequiredAtRuntime: false,
      },
    },
  ],
  supportedDriverIds: [
    "modreef.ghome.wp12",
  ],
  confidence: 0.95,
  notes: [
    "Six AC relays and grouped USB power verified over local Tuya LAN.",
    "Device voltage telemetry verified.",
    "The modREEF mobile app provisions over BLE using the official Tuya SDK.",
    "Tuya cloud is required only for initial credential bootstrap.",
  ],
};
