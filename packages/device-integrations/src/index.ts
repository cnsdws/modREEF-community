import { DeviceIntegrationRegistry } from "@modreef/device-integration";
import { ghomeWp12Integration } from "@modreef/driver-ghome-wp12/integration";
import { jebaoDmpIntegration } from "@modreef/driver-jebao-dmp/integration";
import { jebaoMd44Integration } from "@modreef/driver-jebao-md44/integration";
import { jebaoMdpIntegration } from "@modreef/driver-jebao-mdp/integration";
import { matterIntegration } from "@modreef/driver-matter/integration";
import { yinmikWaterIntegration } from "@modreef/driver-yinmik-water/integration";

export const builtInDeviceIntegrations = new DeviceIntegrationRegistry([
  ghomeWp12Integration,
  jebaoDmpIntegration,
  jebaoMd44Integration,
  jebaoMdpIntegration,
  matterIntegration,
  yinmikWaterIntegration,
]);

export {
  ghomeWp12Integration,
  jebaoDmpIntegration,
  jebaoMd44Integration,
  jebaoMdpIntegration,
  matterIntegration,
  yinmikWaterIntegration,
};
