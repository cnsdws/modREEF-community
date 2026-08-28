import type { EdgeManagedDevice } from "./edgeClient";

const outletDefaultNames = new Set([
  "GHome WP12",
  "Smart Outlet",
  "Smart Power Strip",
  "Tapo Outlet Strip",
  "Tuya Outlet Strip",
]);

const waterMeterDefaultNames = new Set([
  "YINMIK Water 7-in-1",
  "YINMIK Water Sensor",
]);

export function managedDeviceCategory(
  device: EdgeManagedDevice,
): "Outlet" | "Water Meter" | undefined {
  const manufacturer = device.manufacturer?.toLowerCase() ?? "";
  const model = device.model?.toLowerCase() ?? "";

  if (manufacturer.includes("yinmik") || model.includes("water 7-in-1")) {
    return "Water Meter";
  }
  if (
    manufacturer.includes("ghome") ||
    manufacturer.includes("tapo") ||
    model === "wp12" ||
    model.includes("outlet")
  ) {
    return "Outlet";
  }
  return undefined;
}

export function managedDeviceDisplayName(device: EdgeManagedDevice): string {
  const category = managedDeviceCategory(device);
  if (category === "Water Meter" && waterMeterDefaultNames.has(device.name)) {
    return category;
  }
  if (category === "Outlet" && outletDefaultNames.has(device.name)) {
    return category;
  }
  return device.name;
}
