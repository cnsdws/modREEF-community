import { describe, expect, it } from "vitest";

import type { Equipment } from "@modreef/digital-twin";

import {
  getScheduledEquipmentSpeed,
  getScheduledEquipmentState,
} from "../src/index.js";

function createEquipment(): Equipment {
  return {
    id: "lights",
    aquariumId: "reef",
    name: "Display Lights",
    role: "light",
    enabled: false,
    controlMode: "auto",
    connectionStatus: "online",
    healthStatus: "normal",
    schedule: {
      enabled: true,
      events: [
        {
          id: "lights-on",
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          time: "08:00",
          desiredEnabled: true,
        },
        {
          id: "lights-off",
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          time: "20:00",
          desiredEnabled: false,
        },
      ],
    },
  };
}

describe("getScheduledEquipmentState", () => {
  it("returns the most recent scheduled state", () => {
    const equipment = createEquipment();

    expect(
      getScheduledEquipmentState(equipment, {
        weekday: 6,
        time: "12:00",
      }),
    ).toBe(true);

    expect(
      getScheduledEquipmentState(equipment, {
        weekday: 6,
        time: "22:00",
      }),
    ).toBe(false);
  });

  it("wraps safely across the start of the week", () => {
    expect(
      getScheduledEquipmentState(createEquipment(), {
        weekday: 0,
        time: "07:00",
      }),
    ).toBe(false);
  });

  it("keeps always-on equipment enabled in auto", () => {
    const equipment = createEquipment();
    equipment.programType = "always-on";
    delete equipment.schedule;

    expect(
      getScheduledEquipmentState(equipment, {
        weekday: 3,
        time: "12:00",
      }),
    ).toBe(true);
  });

  it("does not schedule manual overrides", () => {
    const equipment = createEquipment();
    equipment.controlMode = "on";

    expect(
      getScheduledEquipmentState(equipment, {
        weekday: 1,
        time: "12:00",
      }),
    ).toBeUndefined();
  });
});

describe("getScheduledEquipmentSpeed", () => {
  function pump(): Equipment {
    return {
      id: "return-pump",
      aquariumId: "reef",
      name: "Return Pump",
      role: "return-pump",
      enabled: true,
      controlMode: "auto",
      connectionStatus: "online",
      healthStatus: "normal",
      speedPercent: 30,
      speedSchedule: {
        enabled: true,
        events: [
          { id: "low", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "00:00", speedPercent: 30 },
          { id: "high", weekdays: [0, 1, 2, 3, 4, 5, 6], time: "12:00", speedPercent: 90 },
        ],
      },
    };
  }

  it("interpolates smoothly while rising and falling across midnight", () => {
    expect(getScheduledEquipmentSpeed(pump(), { weekday: 3, time: "00:00" })).toBe(30);
    expect(getScheduledEquipmentSpeed(pump(), { weekday: 3, time: "06:00" })).toBe(60);
    expect(getScheduledEquipmentSpeed(pump(), { weekday: 3, time: "12:00" })).toBe(90);
    expect(getScheduledEquipmentSpeed(pump(), { weekday: 3, time: "18:00" })).toBe(60);
  });

  it("does not apply a program outside AUTO mode", () => {
    const equipment = pump();
    equipment.controlMode = "on";
    expect(getScheduledEquipmentSpeed(equipment, { weekday: 3, time: "06:00" })).toBeUndefined();
  });
});
