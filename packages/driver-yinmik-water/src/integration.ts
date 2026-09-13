import { defineDeviceIntegration } from "@modreef/device-integration";

import {
  YinmikWaterDriver,
  type YinmikWaterDriverServices,
  type YinmikWaterRegistration,
} from "./driver.js";
import { isYinmikWaterProduct, yinmikWaterProductId } from "./identity.js";

function registration(input: unknown): YinmikWaterRegistration {
  if (!input || typeof input !== "object") throw new Error("Invalid YINMIK registration");
  const record = input as Partial<YinmikWaterRegistration>;
  const credentials = record.credentials;
  if (!record.deviceId?.trim() || !record.displayName?.trim() || !credentials ||
    credentials.deviceId !== record.deviceId || !credentials.networkAddress?.trim() ||
    !credentials.localKey?.trim() || !isYinmikWaterProduct(credentials.productId) ||
    (credentials.protocolVersion !== undefined &&
      !["3.3", "3.4", "3.5"].includes(credentials.protocolVersion))) {
    throw new Error("Invalid YINMIK registration");
  }
  return record as YinmikWaterRegistration;
}

function driverServices(
  services?: Readonly<Record<string, unknown>>,
): YinmikWaterDriverServices {
  if (!services || typeof services.createTransport !== "function") {
    throw new Error("YINMIK integration requires a transport factory");
  }
  if (services.resolveNetworkAddress !== undefined &&
    typeof services.resolveNetworkAddress !== "function") {
    throw new Error("Invalid YINMIK address resolver");
  }
  if (services.persistCredentials !== undefined &&
    typeof services.persistCredentials !== "function") {
    throw new Error("Invalid YINMIK credential persistence service");
  }
  return services as unknown as YinmikWaterDriverServices;
}

export const yinmikWaterIntegration = defineDeviceIntegration({
  schemaVersion: 1,
  id: "modreef.yinmik-water",
  displayName: "YINMIK Water 7-in-1",
  manufacturer: "YINMIK",
  models: ["Water 7-in-1", "WIFI-3188"],
  deviceClass: "water-quality",
  support: "verified",
  protocols: ["tuya-wifi"],
  capabilityKinds: ["temperature", "ph", "orp", "salinity"],
  onboarding: {
    methods: ["bluetooth-wifi"],
    requiresNativeMobileModule: true,
  },
  equipment: [{
    channelId: "water-quality",
    defaultName: "Water Meter",
    role: "sensor",
    lockedRole: true,
  }],
  documentation: "docs/device-profiles/YINMIK-Water-7-in-1.md",
  match: (input) => {
    if (isYinmikWaterProduct(input.productId)) {
      return { confidence: 1, reason: "Tuya product ID" };
    }
    const manufacturer = input.manufacturer?.toLowerCase() ?? "";
    const model = input.model?.toLowerCase() ?? "";
    if (manufacturer.includes("yinmik") &&
      (model.includes("7-in-1") || model.includes("3188"))) {
      return { confidence: 0.9, reason: "manufacturer and model" };
    }
    return null;
  },
  validateRegistration: (input) => { registration(input); },
  createDriver: (input, services) =>
    new YinmikWaterDriver(registration(input), driverServices(services)),
});

export { yinmikWaterProductId };
