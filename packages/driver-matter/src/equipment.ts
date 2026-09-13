import type { AquariumDigitalTwin, Equipment, PhysicalDevice } from "@modreef/digital-twin";

export interface MatterDeviceRegistration {
  deviceId: string;
  driverId: string;
  manufacturer: string;
  model: string;
  endpointIds: number[];
}

export function addMatterDevice(
  twin: AquariumDigitalTwin,
  registration: MatterDeviceRegistration,
  displayName?: string,
): AquariumDigitalTwin {
  const device: PhysicalDevice = {
    id: registration.deviceId,
    aquariumId: twin.aquarium.id,
    name: displayName?.trim() || registration.model,
    manufacturer: registration.manufacturer,
    model: registration.model,
    driverId: registration.driverId,
    connectionStatus: "online",
    createdAt: new Date().toISOString(),
  };
  const equipment: Equipment[] = registration.endpointIds.map((endpointId, index) => ({
    id: `${registration.deviceId}-endpoint-${endpointId}`,
    aquariumId: twin.aquarium.id,
    name: `Outlet ${index + 1}`,
    role: "outlet",
    enabled: false,
    controlMode: "auto",
    connectionStatus: "online",
    healthStatus: "normal",
    binding: {
      driverId: registration.driverId,
      deviceId: registration.deviceId,
      channelId: `endpoint-${endpointId}`,
      capability: "power",
    },
  }));

  return {
    ...twin,
    devices: [...(twin.devices ?? []).filter((item) => item.id !== device.id), device],
    equipment: [
      ...twin.equipment.filter((item) => item.binding?.deviceId !== device.id),
      ...equipment,
    ],
  };
}
