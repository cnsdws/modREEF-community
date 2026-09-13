import { defineDeviceIntegration } from "@modreef/device-integration";

import { JebaoMd44Driver } from "./driver.js";
import { TcpJebaoMd44Transport } from "./transport.js";

interface Registration {
  deviceId: string;
  networkAddress: string;
  displayName: string;
  driverId?: string;
}

function registration(input: unknown): Registration {
  if (!input || typeof input !== "object") throw new Error("Invalid Jebao MD-4.4 registration");
  const record = input as Partial<Registration>;
  if (!record.deviceId?.trim() || !record.networkAddress?.trim() || !record.displayName?.trim()) {
    throw new Error("Invalid Jebao MD-4.4 registration");
  }
  return record as Registration;
}

export const jebaoMd44Integration = defineDeviceIntegration({
  schemaVersion: 1,
  id: "modreef.jebao-md44",
  displayName: "Jebao/Jecod MD-4.4 Doser",
  manufacturer: "Jebao / Jecod",
  models: ["MD-4.4"],
  deviceClass: "doser",
  support: "verified",
  protocols: ["proprietary"],
  capabilityKinds: ["relay", "schedule"],
  onboarding: {
    methods: ["bluetooth-wifi", "lan-discovery"],
    requiresNativeMobileModule: false,
  },
  equipment: Array.from({ length: 4 }, (_, index) => ({
    channelId: `head-${index + 1}`,
    defaultName: `Doser ${index + 1}`,
    role: "doser",
    lockedRole: true,
  })),
  match: (input) => {
    const model = input.model?.toLowerCase() ?? "";
    const name = input.advertisedName?.toLowerCase() ?? "";
    if (model === "md-4.4") return { confidence: 1, reason: "supported model" };
    return name.includes("jebao_wifi")
      ? { confidence: 0.65, reason: "Jebao Wi-Fi setup advertisement" }
      : null;
  },
  validateRegistration: (input) => { registration(input); },
  createDriver: (input) => {
    const record = registration(input);
    return new JebaoMd44Driver(
      record.deviceId,
      new TcpJebaoMd44Transport(record.networkAddress),
      record.driverId ?? `modreef.jebao-md44:${record.deviceId}`,
      record.displayName,
    );
  },
});
