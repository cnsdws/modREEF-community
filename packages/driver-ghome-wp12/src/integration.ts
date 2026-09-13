import { defineDeviceIntegration } from "@modreef/device-integration";

import { GHomeWp12Driver } from "./index.js";
import type { GHomeWp12Transport } from "./transport.js";

interface Registration {
  deviceId: string;
  driverId?: string;
}

function registration(input: unknown): Registration {
  if (!input || typeof input !== "object" ||
    !("deviceId" in input) || typeof input.deviceId !== "string" || !input.deviceId.trim()) {
    throw new Error("Invalid GHome WP12 registration");
  }
  if ("driverId" in input && input.driverId !== undefined && typeof input.driverId !== "string") {
    throw new Error("Invalid GHome WP12 driver id");
  }
  return input as Registration;
}

function transport(services?: Readonly<Record<string, unknown>>): GHomeWp12Transport {
  const candidate = services?.transport;
  if (!candidate || typeof candidate !== "object" ||
    !("readStatus" in candidate) || typeof candidate.readStatus !== "function" ||
    !("setValue" in candidate) || typeof candidate.setValue !== "function" ||
    !("setValues" in candidate) || typeof candidate.setValues !== "function") {
    throw new Error("GHome WP12 integration requires a transport service");
  }
  return candidate as GHomeWp12Transport;
}

export const ghomeWp12Integration = defineDeviceIntegration({
  schemaVersion: 1,
  id: "modreef.ghome-wp12",
  displayName: "GHome WP12 Smart Power Strip",
  manufacturer: "GHome",
  models: ["WP12"],
  deviceClass: "power-strip",
  support: "community-tested",
  protocols: ["tuya-wifi"],
  capabilityKinds: ["relay", "power-monitoring", "countdown"],
  onboarding: {
    methods: ["bluetooth-wifi"],
    requiresNativeMobileModule: true,
  },
  equipment: [
    ...Array.from({ length: 6 }, (_, index) => ({
      channelId: `outlet-${index + 1}`,
      defaultName: `Outlet ${index + 1}`,
      role: "outlet",
    })),
    { channelId: "usb", defaultName: "USB Power", role: "outlet" },
  ],
  documentation: "docs/device-profiles/GHome-WP12.md",
  match: (input) => {
    if (input.productId === "iwmmfr8umokrphak") {
      return { confidence: 1, reason: "Tuya product ID" };
    }
    if (input.manufacturer?.toLowerCase().includes("ghome") &&
      input.model?.toLowerCase() === "wp12") {
      return { confidence: 0.95, reason: "manufacturer and model" };
    }
    return null;
  },
  validateRegistration: (input) => { registration(input); },
  createDriver: (input, services) => {
    const record = registration(input);
    return new GHomeWp12Driver(record.deviceId, transport(services), record.driverId);
  },
});
