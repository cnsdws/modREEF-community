import {
  GHomeWp12Driver,
  PythonGHomeWp12Transport,
} from "../packages/driver-ghome-wp12/src/index.js";

const deviceId = "ghome-wp12";
const transport = new PythonGHomeWp12Transport();
const driver = new GHomeWp12Driver(deviceId, transport);

await driver.connect(deviceId);

console.dir(await driver.getState(deviceId), {
  depth: null,
});
