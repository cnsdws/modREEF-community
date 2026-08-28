import type {
  EquipmentProgramType,
  EquipmentRole,
} from "@modreef/digital-twin";

export function programTypeForEquipmentRole(
  role: EquipmentRole,
): EquipmentProgramType | null {
  switch (role) {
    case "return-pump":
    case "skimmer":
    case "heater":
      return role;
    case "doser":
      return "dosing-pump";
    case "light":
      return "light-schedule";
    default:
      return null;
  }
}

export function equipmentRoleLabel(role: EquipmentRole): string {
  if (role === "uv") return "UV";
  if (role === "ato") return "ATO";
  return role
    .split("-")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}
