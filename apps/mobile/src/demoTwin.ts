import type { AquariumDigitalTwin } from "@modreef/digital-twin";

const simulatorBinding = {
  driverId: "modreef.simulator.smart-strip",
  deviceId: "simulated-smart-strip",
} as const;

export const demoTwin: AquariumDigitalTwin = {
  aquarium: {
    id: "dennis-display-reef",
    name: "Dennis's Reef",
    description: "90 Gallon SPS Reef",
    displayVolumeGallons: 90,
    totalSystemVolumeGallons: 110,
    systemType: "reef",
    createdAt: "2026-07-11T09:00:00-06:00",
  },

  equipment: [
    {
      id: "return-pump",
      aquariumId: "dennis-display-reef",
      name: "Return Pump",
      role: "return-pump",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
      binding: {
        ...simulatorBinding,
        channelId: "outlet-1",
        capability: "power",
      },
    },
    {
      id: "mp40-left",
      aquariumId: "dennis-display-reef",
      name: "Left MP40",
      role: "circulation-pump",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
    },
    {
      id: "mp40-right",
      aquariumId: "dennis-display-reef",
      name: "Right MP40",
      role: "circulation-pump",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
    },
    {
      id: "protein-skimmer",
      aquariumId: "dennis-display-reef",
      name: "Protein Skimmer",
      role: "skimmer",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
      binding: {
        ...simulatorBinding,
        channelId: "outlet-2",
        capability: "power",
      },
    },
    {
      id: "uv-sterilizer",
      aquariumId: "dennis-display-reef",
      name: "UV Sterilizer",
      role: "uv",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
      binding: {
        ...simulatorBinding,
        channelId: "outlet-3",
        capability: "power",
      },
    },
    {
      id: "heater",
      aquariumId: "dennis-display-reef",
      name: "Heater",
      role: "heater",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
      binding: {
        ...simulatorBinding,
        channelId: "outlet-4",
        capability: "power",
      },
    },
    {
      id: "display-lights",
      aquariumId: "dennis-display-reef",
      name: "Display Lights",
      role: "light",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
    },
  ],

  measurements: [],
  recommendations: [],
};
