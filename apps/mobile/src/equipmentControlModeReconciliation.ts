import {
  getEquipmentControlMode,
  type Equipment,
  type EquipmentControlMode,
} from "@modreef/digital-twin";

export function equipmentWithRequestedControlMode(
  equipment: Equipment,
  mode: EquipmentControlMode,
): Equipment {
  return {
    ...equipment,
    controlMode: mode,
    ...(mode === "auto"
      ? equipment.programType === "dosing-pump" ? { enabled: false } : {}
      : { enabled: mode === "on" }),
  };
}

export function applyPendingEquipmentControlModes(
  equipment: Equipment[],
  pendingModes: ReadonlyMap<string, EquipmentControlMode>,
): Equipment[] {
  return equipment.map((item) => {
    const pendingMode = pendingModes.get(item.id);
    if (!pendingMode || getEquipmentControlMode(item) === pendingMode) return item;
    return equipmentWithRequestedControlMode(item, pendingMode);
  });
}
