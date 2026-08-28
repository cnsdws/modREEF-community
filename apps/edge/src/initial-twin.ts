import type { AquariumDigitalTwin } from "@modreef/digital-twin";

export function createInitialTwin(
  createdAt = new Date().toISOString(),
): AquariumDigitalTwin {
  return {
    aquarium: {
      id: "reef",
      name: "modREEF",
      description: "Primary reef aquarium",
      displayVolumeGallons: 90,
      systemType: "reef",
      createdAt,
    },
    equipment: [],
    measurements: [],
    recommendations: [],
  };
}
