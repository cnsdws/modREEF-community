import { defineDeviceIntegration } from "@modreef/device-integration";

import { MatterOutletDriver } from "./controller.js";

interface MatterRegistration {
  deviceId: string;
}

function registration(input: unknown): MatterRegistration {
  if (!input || typeof input !== "object" ||
    !("deviceId" in input) || typeof input.deviceId !== "string" ||
    !/^matter-\d+$/.test(input.deviceId)) {
    throw new Error("Invalid Matter device registration");
  }
  return input as MatterRegistration;
}

export const matterIntegration = defineDeviceIntegration({
  schemaVersion: 1,
  id: "modreef.matter",
  displayName: "Matter Outlet or Power Strip",
  manufacturer: "Matter",
  models: ["On/Off Plug-in Unit", "Multi-endpoint Power Strip"],
  deviceClass: "power-strip",
  support: "community-tested",
  protocols: ["matter"],
  capabilityKinds: ["relay", "power-monitoring", "energy-monitoring"],
  onboarding: {
    methods: ["matter"],
    requiresNativeMobileModule: false,
  },
  equipment: [{
    channelId: "endpoint-*",
    defaultName: "Outlet",
    role: "outlet",
  }],
  documentation: "docs/device-profiles/Matter-Outlets.md",
  match: (input) => {
    if (input.protocols?.some((protocol) => protocol.toLowerCase() === "matter")) {
      return { confidence: 1, reason: "Matter protocol" };
    }
    const manufacturer = input.manufacturer?.toLowerCase() ?? "";
    const model = input.model?.toLowerCase() ?? "";
    if (manufacturer.includes("matter") || model.includes("matter")) {
      return { confidence: 0.7, reason: "Matter manufacturer or model metadata" };
    }
    return null;
  },
  validateRegistration: (input) => { registration(input); },
  createDriver: (input) => new MatterOutletDriver(registration(input).deviceId),
});
