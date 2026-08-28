const base = require("./app.json");

const tuyaSetting = process.env.MODREEF_ENABLE_TUYA_PROVISIONING;
const hasTuyaIosConfiguration = Boolean(
  process.env.TUYA_IOS_CORE_SDK_PATH &&
    process.env.TUYA_IOS_APP_KEY &&
    process.env.TUYA_IOS_APP_SECRET,
);
const tuyaProvisioningEnabled =
  tuyaSetting === "1" ||
  (tuyaSetting !== "0" && hasTuyaIosConfiguration);

const plugins = base.expo.plugins.filter(
  (plugin) => plugin !== "./plugins/withTuyaIos",
);

module.exports = {
  ...base,
  expo: {
    ...base.expo,
    plugins: tuyaProvisioningEnabled
      ? [...plugins, "./plugins/withTuyaIos"]
      : plugins,
    autolinking: {
      nativeModulesDir: tuyaProvisioningEnabled
        ? "./modules"
        : "./modules-open-source",
    },
    extra: {
      ...base.expo.extra,
      tuyaProvisioningEnabled,
    },
  },
};
