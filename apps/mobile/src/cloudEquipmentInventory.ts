import type { Equipment, PhysicalDevice } from "@modreef/digital-twin";

export interface CloudEquipmentInventoryGroup {
  key: string;
  controllerId?: string;
  controllerName: string;
  deviceId?: string;
  deviceName: string;
  equipment: Equipment[];
}

export function groupCloudEquipmentInventory(
  equipment: Equipment[],
  controllerNames: Record<string, string>,
  controllerIds: Record<string, string> = {},
  devices: PhysicalDevice[] = [],
  deviceControllerIds: Record<string, string> = {},
  edgeNames: Record<string, string> = {},
): CloudEquipmentInventoryGroup[] {
  const groups = new Map<string, CloudEquipmentInventoryGroup>();

  for (const device of devices) {
    const controllerId = deviceControllerIds[device.id];
    const controllerName = controllerId ? edgeNames[controllerId] : undefined;
    const key = `${controllerId ?? "unassigned"}\u0000${device.id}`;
    groups.set(key, {
      key,
      ...(controllerId ? { controllerId } : {}),
      controllerName: controllerName ?? "Reef Controller",
      deviceId: device.id,
      deviceName: device.name,
      equipment: [],
    });
  }

  for (const item of equipment) {
    const controllerName = controllerNames[item.id] ?? "Reef Controller";
    const controllerId = controllerIds[item.id];
    const deviceId = item.physicalDeviceId ?? item.binding?.deviceId;
    const deviceName = item.physicalDeviceName ?? "Unidentified physical device";
    const key = `${controllerId ?? controllerName}\u0000${deviceId ?? deviceName}`;
    const canonicalKey = deviceId && controllerId
      ? `${controllerId}\u0000${deviceId}`
      : key;
    const group = groups.get(canonicalKey);

    if (group) {
      group.equipment.push(item);
    } else {
      groups.set(canonicalKey, {
        key: canonicalKey,
        ...(controllerId ? { controllerId } : {}),
        controllerName,
        ...(deviceId ? { deviceId } : {}),
        deviceName,
        equipment: [item],
      });
    }
  }

  return [...groups.values()];
}
