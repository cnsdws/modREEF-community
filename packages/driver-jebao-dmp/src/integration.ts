import { defineDeviceIntegration } from "@modreef/device-integration";

import {
  JebaoDmpDriver,
  type JebaoDmpRegistration,
} from "./driver.js";
import { isDmpPairingName } from "./ble.js";

function registration(input: unknown): JebaoDmpRegistration {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid Jebao DMP registration");
  }
  const record = input as Partial<JebaoDmpRegistration>;
  if (!record.deviceId || !/^dmp-[0-9a-f]{4,12}$/i.test(record.deviceId) ||
    !record.displayName?.trim() || !record.advertisedName ||
    !isDmpPairingName(record.advertisedName) || !record.bluetoothAddress ||
    !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(record.bluetoothAddress)) {
    throw new Error("Invalid Jebao DMP registration");
  }
  return {
    ...record,
    deviceId: record.deviceId.toLowerCase(),
    displayName: record.displayName.trim(),
    bluetoothAddress: record.bluetoothAddress.toUpperCase(),
  } as JebaoDmpRegistration;
}

export const jebaoDmpIntegration = defineDeviceIntegration({
  schemaVersion: 1,
  id: "modreef.jebao-dmp",
  displayName: "Jebao/Jecod DMP Wavemaker",
  manufacturer: "Jebao / Jecod",
  models: ["DMP-40"],
  deviceClass: "wavemaker",
  support: "verified",
  protocols: ["bluetooth"],
  capabilityKinds: ["relay", "variable-speed", "schedule"],
  onboarding: {
    methods: ["bluetooth-control"],
    requiresNativeMobileModule: false,
  },
  equipment: [{
    channelId: "pump",
    defaultName: "Wavemaker",
    role: "circulation-pump",
    lockedRole: true,
  }],
  documentation: "docs/device-profiles/Jebao-DMP.md",
  match: (input) => {
    if (input.serviceUuids?.some((uuid) => uuid.toLowerCase() === "abf0") &&
      input.advertisedName && isDmpPairingName(input.advertisedName)) {
      return { confidence: 1, reason: "DMP pairing name and ABF0 service" };
    }
    if (input.advertisedName && isDmpPairingName(input.advertisedName)) {
      return { confidence: 0.9, reason: "DMP pairing name" };
    }
    return input.model?.toUpperCase() === "DMP-40"
      ? { confidence: 0.85, reason: "supported model" }
      : null;
  },
  validateRegistration: (input) => { registration(input); },
  createDriver: (input) => new JebaoDmpDriver(registration(input)),
});
