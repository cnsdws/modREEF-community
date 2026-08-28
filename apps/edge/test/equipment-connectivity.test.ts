import { describe, expect, it } from "vitest";

import type { AquariumDigitalTwin } from "@modreef/digital-twin";
import { setDeviceConnectivity } from "../src/equipment-connectivity.js";

const twin = {
  aquarium: { id: "reef" },
  devices: [{
    id: "mdp-1",
    aquariumId: "reef",
    name: "Return Pump",
    manufacturer: "Jebao",
    model: "MDP-8500",
    driverId: "modreef.jebao-mdp:mdp-1",
    connectionStatus: "online",
    createdAt: "2026-08-02T00:00:00.000Z",
  }],
  equipment: [{
    id: "return-pump",
    aquariumId: "reef",
    name: "Return Pump",
    role: "return-pump",
    enabled: true,
    connectionStatus: "online",
    healthStatus: "normal",
    binding: {
      driverId: "modreef.jebao-mdp:mdp-1",
      deviceId: "mdp-1",
      channelId: "pump",
      capability: "speed",
    },
  }],
  measurements: [],
  routines: [],
} as unknown as AquariumDigitalTwin;

describe("equipment connectivity", () => {
  it("marks the physical device and all bound equipment offline", () => {
    const updated = setDeviceConnectivity(
      twin,
      "modreef.jebao-mdp:mdp-1",
      "mdp-1",
      false,
    );
    expect(updated.devices?.[0]?.connectionStatus).toBe("offline");
    expect(updated.equipment[0]?.connectionStatus).toBe("offline");
  });

  it("clears the connection fault after telemetry recovers", () => {
    const offline = setDeviceConnectivity(
      twin,
      "modreef.jebao-mdp:mdp-1",
      "mdp-1",
      false,
    );
    const recovered = setDeviceConnectivity(
      offline,
      "modreef.jebao-mdp:mdp-1",
      "mdp-1",
      true,
    );
    expect(recovered.devices?.[0]?.connectionStatus).toBe("online");
    expect(recovered.equipment[0]?.connectionStatus).toBe("online");
  });
});
