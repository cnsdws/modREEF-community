import { defineDeviceIntegration } from "@modreef/device-integration";

import { JebaoMdpDriver } from "./index.js";
import { TcpMdpTransport } from "./transport.js";

interface Registration {
  deviceId: string;
  networkAddress: string;
  displayName: string;
  model: "MDP-8500" | "MDP-20000";
  driverId?: string;
}

function registration(input: unknown): Registration {
  if (!input || typeof input !== "object") throw new Error("Invalid Jebao MDP registration");
  const record = input as Partial<Registration>;
  if (!record.deviceId?.trim() || !record.networkAddress?.trim() || !record.displayName?.trim() ||
    (record.model !== "MDP-8500" && record.model !== "MDP-20000")) {
    throw new Error("Invalid Jebao MDP registration");
  }
  return record as Registration;
}

export const jebaoMdpIntegration = defineDeviceIntegration({
  schemaVersion: 1,
  id: "modreef.jebao-mdp",
  displayName: "Jebao/Jecod MDP Return Pump",
  manufacturer: "Jebao / Jecod",
  models: ["MDP-8500", "MDP-20000"],
  deviceClass: "return-pump",
  support: "verified",
  protocols: ["proprietary"],
  capabilityKinds: ["relay", "variable-speed", "schedule"],
  onboarding: {
    methods: ["lan-discovery", "manual"],
    requiresNativeMobileModule: false,
  },
  equipment: [{
    channelId: "pump",
    defaultName: "Return Pump",
    role: "return-pump",
    lockedRole: true,
  }],
  documentation: "docs/integrations/jebao-mdp-clean-room.md",
  match: (input) => {
    const name = input.advertisedName?.toLowerCase() ?? "";
    const model = input.model?.toUpperCase() ?? "";
    if (model === "MDP-8500" || model === "MDP-20000") {
      return { confidence: 1, reason: "supported model" };
    }
    return name.includes("mdp")
      ? { confidence: 0.7, reason: "advertised MDP family name" }
      : null;
  },
  validateRegistration: (input) => { registration(input); },
  createDriver: (input, services) => {
    const record = registration(input);
    const resolveHost = services?.resolveHost;
    if (resolveHost !== undefined && typeof resolveHost !== "function") {
      throw new Error("Invalid Jebao MDP host resolver");
    }
    return new JebaoMdpDriver(
      record.deviceId,
      new TcpMdpTransport(record.networkAddress, {
        ...(resolveHost ? { resolveHost: resolveHost as () => Promise<string> } : {}),
      }),
      record.driverId ?? `modreef.jebao-mdp:${record.deviceId}`,
      record.model,
      record.displayName,
    );
  },
});
