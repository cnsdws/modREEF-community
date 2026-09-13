import type { AquariumRole } from "@modreef/api-contract";

const roleRank: Record<AquariumRole, number> = {
  view: 0,
  control: 1,
  program: 2,
  manage: 3,
  owner: 4,
};

export const transientCommandTypes = [
  "automation.feed-cycle.start",
  "automation.feed-cycle.stop",
  "equipment.run-doser-calibration",
  "equipment.set-control-mode",
  "equipment.set-power",
  "equipment.set-speed",
  "equipment.set-wavemaker-configuration",
  "routine.finish",
  "routine.run",
  "routine.stop",
] as const;
const controlCommands = new Set<string>(transientCommandTypes);

export function hasAquariumRole(
  role: AquariumRole | null,
  minimum: AquariumRole,
): boolean {
  return role !== null && roleRank[role] >= roleRank[minimum];
}

export function requiredRoleForCommand(type: string): AquariumRole {
  if (controlCommands.has(type)) return "control";
  if (type.startsWith("managed-device.") || type.startsWith("controller.")) return "manage";
  return "program";
}
