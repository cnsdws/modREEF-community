const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

const sources = [
  "source 'https://github.com/CocoaPods/Specs.git'",
  "source 'https://github.com/TuyaInc/TuyaPublicSpecs.git'",
  "source 'https://github.com/tuya/tuya-pod-specs.git'",
];

module.exports = function withTuyaIos(config) {
  return withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const sdkPath = process.env.TUYA_IOS_CORE_SDK_PATH;
      const appKey = process.env.TUYA_IOS_APP_KEY;
      const appSecret = process.env.TUYA_IOS_APP_SECRET;

      if (!sdkPath) {
        throw new Error(
          "TUYA_IOS_CORE_SDK_PATH must point to ios_core_sdk",
        );
      }

      if (!appKey || !appSecret) {
        throw new Error(
          "TUYA_IOS_APP_KEY and TUYA_IOS_APP_SECRET are required",
        );
      }

      const podspec = path.join(
        sdkPath,
        "ThingSmartCryption.podspec",
      );

      if (!fs.existsSync(podspec)) {
        throw new Error(`Tuya podspec not found: ${podspec}`);
      }

      const iosRoot = modConfig.modRequest.platformProjectRoot;
      const sdkLink = path.join(iosRoot, "ios_core_sdk");

      if (fs.existsSync(sdkLink)) {
        const stat = fs.lstatSync(sdkLink);
        if (!stat.isSymbolicLink()) {
          throw new Error(
            `${sdkLink} exists and is not a symbolic link`,
          );
        }
        fs.unlinkSync(sdkLink);
      }

      fs.symlinkSync(sdkPath, sdkLink, "dir");

      const podfilePath = path.join(iosRoot, "Podfile");
      let podfile = fs.readFileSync(podfilePath, "utf8");

      if (!podfile.includes("TuyaPublicSpecs.git")) {
        podfile = `${sources.join("\n")}\n\n${podfile}`;
      }

      if (!podfile.includes("pod 'ThingSmartHomeKit'")) {
        podfile = podfile.replace(
          "  use_expo_modules!\n",
          [
            "  use_expo_modules!",
            "",
            "  pod 'ThingSmartHomeKit', '~> 7.5.0'",
            "  pod 'ThingSmartCryption', :path => './ios_core_sdk'",
            "",
          ].join("\n"),
        );
      }

      fs.writeFileSync(podfilePath, podfile);

      const appDelegatePath = path.join(
        iosRoot,
        "modREEF",
        "AppDelegate.swift",
      );
      let appDelegate = fs.readFileSync(appDelegatePath, "utf8");

      if (!appDelegate.includes("import ThingSmartHomeKit")) {
        appDelegate = appDelegate.replace(
          "import ReactAppDependencyProvider\n",
          "import ReactAppDependencyProvider\nimport ThingSmartHomeKit\n",
        );
      }

      if (!appDelegate.includes("ThingSmartSDK.sharedInstance()")) {
        const initialization = [
          "    ThingSmartSDK.sharedInstance().start(",
          `      withAppKey: ${JSON.stringify(appKey)},`,
          `      secretKey: ${JSON.stringify(appSecret)}`,
          "    )",
          "",
        ].join("\n");

        appDelegate = appDelegate.replace(
          "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
          initialization +
            "    return super.application(application, didFinishLaunchingWithOptions: launchOptions)",
        );
      }

      fs.writeFileSync(appDelegatePath, appDelegate);
      return modConfig;
    },
  ]);
};
