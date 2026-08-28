#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_ROOT="${REPOSITORY_ROOT}/apps/mobile"

env \
  -u MODREEF_ENABLE_TUYA_PROVISIONING \
  -u TUYA_IOS_CORE_SDK_PATH \
  -u TUYA_IOS_APP_KEY \
  -u TUYA_IOS_APP_SECRET \
  node -e '
    const config = require(process.argv[1]);
    if (config.expo.plugins.includes("./plugins/withTuyaIos")) {
      throw new Error("The standard source build unexpectedly enables Tuya");
    }
    if (config.expo.autolinking.nativeModulesDir !== "./modules-open-source") {
      throw new Error("The standard source build scans proprietary modules");
    }
    if (config.expo.extra.tuyaProvisioningEnabled !== false) {
      throw new Error("The standard source build reports Tuya as enabled");
    }
  ' "${MOBILE_ROOT}/app.config.js"

MODREEF_ENABLE_TUYA_PROVISIONING=1 node -e '
  const config = require(process.argv[1]);
  if (!config.expo.plugins.includes("./plugins/withTuyaIos")) {
    throw new Error("The authorized build did not enable the Tuya plugin");
  }
  if (config.expo.autolinking.nativeModulesDir !== "./modules") {
    throw new Error("The authorized build did not scan native modules");
  }
  if (config.expo.extra.tuyaProvisioningEnabled !== true) {
    throw new Error("The authorized build reports Tuya as disabled");
  }
' "${MOBILE_ROOT}/app.config.js"

echo "Open-source and authorized native build boundaries are valid."
