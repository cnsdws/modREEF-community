import type { AquariumDigitalTwin } from "@modreef/digital-twin";

export function setDeviceConnectivity(
  twin: AquariumDigitalTwin,
  driverId: string,
  deviceId: string,
  connected: boolean,
): AquariumDigitalTwin {
  const connectionStatus = connected ? "online" : "offline";
  const deviceNeedsUpdate = twin.devices?.some((device) =>
    device.id === deviceId &&
    device.driverId === driverId &&
    device.connectionStatus !== connectionStatus
  ) ?? false;
  const equipmentNeedsUpdate = twin.equipment.some((equipment) =>
    equipment.binding?.deviceId === deviceId &&
    equipment.binding.driverId === driverId &&
    equipment.connectionStatus !== connectionStatus
  );
  if (!deviceNeedsUpdate && !equipmentNeedsUpdate) return twin;

  return {
    ...twin,
    ...(twin.devices ? {
      devices: twin.devices.map((device) =>
        device.id === deviceId && device.driverId === driverId
          ? { ...device, connectionStatus }
          : device
      ),
    } : {}),
    equipment: twin.equipment.map((equipment) =>
      equipment.binding?.deviceId === deviceId &&
        equipment.binding.driverId === driverId
        ? { ...equipment, connectionStatus }
        : equipment
    ),
  };
}
