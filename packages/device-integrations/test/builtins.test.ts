import { describe, expect, it } from "vitest";

import { builtInDeviceIntegrations } from "../src/index.js";

describe("built-in device integrations", () => {
  it("registers every packaged hardware driver once", () => {
    expect(builtInDeviceIntegrations.list().map(({ id }) => id)).toEqual([
      "modreef.ghome-wp12",
      "modreef.jebao-dmp",
      "modreef.jebao-md44",
      "modreef.jebao-mdp",
      "modreef.matter",
      "modreef.yinmik-water",
    ]);
  });

  it("identifies exact product and model evidence", () => {
    expect(builtInDeviceIntegrations.identify({ productId: "iwmmfr8umokrphak" })[0]
      ?.integration.id).toBe("modreef.ghome-wp12");
    expect(builtInDeviceIntegrations.identify({ model: "MDP-8500" })[0]
      ?.integration.id).toBe("modreef.jebao-mdp");
    expect(builtInDeviceIntegrations.identify({ model: "MD-4.4" })[0]
      ?.integration.id).toBe("modreef.jebao-md44");
    expect(builtInDeviceIntegrations.identify({
      advertisedName: "W_CE32B4",
      serviceUuids: ["abf0"],
    })[0]?.integration.id).toBe("modreef.jebao-dmp");
    expect(builtInDeviceIntegrations.identify({
      productId: "u5xgcpcngk3pfxb4",
    })[0]?.integration.id).toBe("modreef.yinmik-water");
    expect(builtInDeviceIntegrations.identify({
      protocols: ["matter"],
    })[0]?.integration.id).toBe("modreef.matter");
  });
});
