import {
  GHomeWp12Driver,
  PythonGHomeWp12Transport,
} from "../packages/driver-ghome-wp12/src/index.js";

const channelId = process.argv[2];
const state = process.argv[3];

if (!channelId || !["on", "off"].includes(state ?? "")) {
  throw new Error(
    "Usage: ghome-driver-set.ts <outlet-1..outlet-6|usb> <on|off>",
  );
}

const deviceId = "ghome-wp12";
const driver = new GHomeWp12Driver(
  deviceId,
  new PythonGHomeWp12Transport(),
);

await driver.connect(deviceId);

const result = await driver.execute({
  type: "set-relay",
  deviceId,
  channelId,
  on: state === "on",
});

console.dir(result.resultingState?.channels[channelId], {
  depth: null,
});
