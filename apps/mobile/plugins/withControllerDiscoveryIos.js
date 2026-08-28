const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withControllerDiscoveryIos(config) {
  return withInfoPlist(config, (modConfig) => {
    const services = Array.isArray(modConfig.modResults.NSBonjourServices)
      ? modConfig.modResults.NSBonjourServices
      : [];

    modConfig.modResults.NSBonjourServices = [
      ...new Set([...services, "_modreef._tcp."]),
    ];
    modConfig.modResults.NSLocalNetworkUsageDescription =
      "Allow modREEF to find and connect to Reef Controllers on your aquarium network.";

    return modConfig;
  });
};
