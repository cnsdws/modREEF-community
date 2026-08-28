import type { EquipmentProgramType } from "@modreef/digital-twin";

export const equipmentProgramChoices: {
  type: EquipmentProgramType;
  label: string;
  description: string;
}[] = [
  { type: "always-on", label: "Always On", description: "Continuous power in AUTO" },
  { type: "schedule", label: "Schedule", description: "Scheduled ON and OFF times" },
  { type: "heater", label: "Heater", description: "Temperature template foundation" },
  { type: "return-pump", label: "Return Pump", description: "Normally on; responds to Feed Mode" },
  { type: "skimmer", label: "Skimmer", description: "Normally on; responds to Feed Mode" },
  { type: "dosing-pump", label: "Dosing Pump", description: "Timed, repeating doses" },
  { type: "advanced", label: "Advanced", description: "Guided structured rules" },
];
