import type {
  AquariumDigitalTwin,
  Equipment,
  PhysicalDevice,
} from "@modreef/digital-twin";

const controllableChannels = [
  ["outlet-1", "Outlet 1"],
  ["outlet-2", "Outlet 2"],
  ["outlet-3", "Outlet 3"],
  ["outlet-4", "Outlet 4"],
  ["outlet-5", "Outlet 5"],
  ["outlet-6", "Outlet 6"],
  ["usb", "USB Power"],
] as const;

const legacyDeviceId = "ghome-wp12";

function equipmentId(deviceId: string, channelId: string): string {
  return deviceId === legacyDeviceId
    ? `ghome-wp12-${channelId}`
    : `ghome-wp12-${encodeURIComponent(deviceId)}-${channelId}`;
}

export function createGHomeWp12Device(
  twin: AquariumDigitalTwin,
  driverId: string,
  deviceId: string,
): PhysicalDevice {
  return {
    id: deviceId,
    aquariumId: twin.aquarium.id,
    name: "Outlet",
    manufacturer: "GHome",
    model: "WP12",
    driverId,
    connectionStatus: "unknown",
    createdAt: new Date().toISOString(),
  };
}

export function ensureGHomeWp12Equipment(
  twin: AquariumDigitalTwin,
  driverId: string,
  deviceId: string,
): AquariumDigitalTwin {
  const migratingLegacyTwin = twin.devices === undefined;
  const devices = migratingLegacyTwin
    ? [createGHomeWp12Device(twin, driverId, deviceId)]
    : twin.devices ?? [];

  if (!devices.some((device) => device.id === deviceId)) {
    return twin;
  }

  let changed = migratingLegacyTwin;
  const equipment: Equipment[] = twin.equipment.map((item) => {
    if (
      item.binding?.driverId === driverId &&
      item.binding.deviceId === deviceId &&
      item.controlMode === undefined
    ) {
      changed = true;
      return {
        ...item,
        controlMode: "auto",
      };
    }

    return item;
  });

  for (const [channelId, name] of controllableChannels) {
    const exists = equipment.some(
      (item) =>
        item.binding?.driverId === driverId &&
        item.binding.deviceId === deviceId &&
        item.binding.channelId === channelId,
    );

    if (exists) {
      continue;
    }

    const item: Equipment = {
      id: equipmentId(deviceId, channelId),
      aquariumId: twin.aquarium.id,
      name,
      role: "outlet",
      enabled: false,
      controlMode: "auto",
      connectionStatus: "unknown",
      healthStatus: "normal",
      binding: {
        driverId,
        deviceId,
        channelId,
        capability: "power",
      },
    };

    equipment.push(item);
    changed = true;
  }

  if (!changed) {
    return twin;
  }

  return {
    ...twin,
    devices,
    equipment,
  };
}
