import { describe, expect, it } from "vitest";

import type {
  AquariumDigitalTwin,
} from "../src/index.js";

import {
  getDosingRuntimeSeconds,
  isMeasurementEquipment,
  setDoserCalibration,
  setAdvancedOutletProgram,
  setEquipmentIntervalProgram,
  setEquipmentProgramType,
  updateEquipmentDetails,
  updatePhysicalDeviceName,
} from "../src/index.js";

describe("isMeasurementEquipment", () => {
  it("does not confuse a powered outlet classified as Sensor with a telemetry source", () => {
    expect(isMeasurementEquipment({
      role: "sensor",
      physicalCapability: "power",
    })).toBe(false);
    expect(isMeasurementEquipment({
      role: "sensor",
      physicalCapability: "measurement",
    })).toBe(true);
  });
});

const twin: AquariumDigitalTwin = {
  aquarium: {
    id: "reef",
    name: "Test Reef",
    description: "Test",
    displayVolumeGallons: 90,
    systemType: "reef",
    createdAt: "2026-07-15T00:00:00Z",
  },
  equipment: [
    {
      id: "return-pump",
      aquariumId: "reef",
      name: "Return Pump",
      role: "return-pump",
      enabled: true,
      connectionStatus: "online",
      healthStatus: "normal",
    },
  ],
  measurements: [],
  recommendations: [],
};

describe("updateEquipmentDetails", () => {
  it("updates reef-facing details without mutating the twin", () => {
    const updated = updateEquipmentDetails(
      twin,
      "return-pump",
      {
        name: "Main Return Pump",
        role: "return-pump",
        automaticRestartDelaySeconds: 300,
      },
    );

    expect(updated.equipment[0]?.name).toBe("Main Return Pump");
    expect(updated.equipment[0]?.automaticRestartDelaySeconds).toBe(300);
    expect(twin.equipment[0]?.name).toBe("Return Pump");
  });
});

describe("updatePhysicalDeviceName", () => {
  it("renames a physical device without mutating the twin", () => {
    const twinWithDevice: AquariumDigitalTwin = {
      ...twin,
      devices: [
        {
          id: "power-strip",
          aquariumId: "reef",
          name: "GHome WP12",
          manufacturer: "GHome",
          model: "WP12",
          driverId: "modreef.ghome.wp12",
          connectionStatus: "online",
          createdAt: "2026-07-23T00:00:00.000Z",
        },
      ],
    };

    const updated = updatePhysicalDeviceName(
      twinWithDevice,
      "power-strip",
      "Main Power Strip",
    );

    expect(updated.devices?.[0]?.name).toBe("Main Power Strip");
    expect(twinWithDevice.devices?.[0]?.name).toBe("GHome WP12");
  });
});

describe("setEquipmentIntervalProgram", () => {
  const intervalProgram = {
    enabled: false,
    startTime: "08:00",
    durationSeconds: 30,
    intervalSeconds: 3_600,
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    fallbackState: "off" as const,
    maximumDailyRuntimeSeconds: 300,
  };

  it("always activates a saved dosing program", () => {
    const dosingTwin: AquariumDigitalTwin = {
      ...twin,
      equipment: [
        {
          ...twin.equipment[0]!,
          role: "doser",
          programType: "dosing-pump",
        },
      ],
    };

    const updated = setEquipmentIntervalProgram(
      dosingTwin,
      "return-pump",
      intervalProgram,
    );

    expect(updated.equipment[0]?.intervalProgram?.enabled).toBe(true);
    expect(updated.equipment[0]?.role).toBe("doser");
  });

  it("preserves explicit enablement for advanced rules", () => {
    const advancedTwin: AquariumDigitalTwin = {
      ...twin,
      equipment: [
        {
          ...twin.equipment[0]!,
          programType: "advanced",
        },
      ],
    };

    const updated = setEquipmentIntervalProgram(
      advancedTwin,
      "return-pump",
      intervalProgram,
    );

    expect(updated.equipment[0]?.intervalProgram?.enabled).toBe(false);
  });
});

describe("setEquipmentProgramType", () => {
  it("configures dosing-pump equipment as a doser", () => {
    const updated = setEquipmentProgramType(
      twin,
      "return-pump",
      "dosing-pump",
    );

    expect(updated.equipment[0]?.programType).toBe("dosing-pump");
    expect(updated.equipment[0]?.role).toBe("doser");
  });

  it("does not rewrite the equipment role for other programs", () => {
    const updated = setEquipmentProgramType(
      twin,
      "return-pump",
      "schedule",
    );

    expect(updated.equipment[0]?.role).toBe("return-pump");
  });

  it("rejects a program type unsupported by locked physical equipment", () => {
    const lockedTwin: AquariumDigitalTwin = {
      ...twin,
      equipment: [{
        ...twin.equipment[0]!,
        name: "Doser 1",
        role: "doser",
        programType: "dosing-pump",
        supportedProgramTypes: ["dosing-pump"],
        programTypeLocked: true,
      }],
    };

    expect(() => setEquipmentProgramType(
      lockedTwin,
      "return-pump",
      "schedule",
    )).toThrow("Doser 1 only supports dosing-pump");
  });
});

describe("setAdvancedOutletProgram", () => {
  const advancedTwin = setEquipmentProgramType(twin, "return-pump", "advanced");
  const program = {
    schema: "modreef.advanced-outlet-program" as const,
    version: 1 as const,
    id: "advanced-return",
    revision: 1,
    name: "Advanced return",
    enabled: true,
    defaultState: "on" as const,
    fallbackState: "on" as const,
    rules: [],
    safety: { missingInputState: "off" as const, deferOnSeconds: 0, deferOffSeconds: 0, minimumOnSeconds: 0, minimumOffSeconds: 0 },
    updatedAt: "2026-08-03T12:00:00.000Z",
  };

  it("stores a versioned program on advanced equipment", () => {
    const migrated = setAdvancedOutletProgram({
      ...advancedTwin,
      equipment: [{ ...advancedTwin.equipment[0]!, intervalProgram: {
        enabled: true, startTime: "08:00", durationSeconds: 30,
        intervalSeconds: 3600, weekdays: [1], fallbackState: "off",
        maximumDailyRuntimeSeconds: 300,
      } }],
    }, "return-pump", program);
    expect(migrated.equipment[0]?.advancedOutletProgram).toEqual(program);
    expect(migrated.equipment[0]?.intervalProgram).toBeUndefined();
  });

  it("rejects stale and conflicting revisions", () => {
    const saved = setAdvancedOutletProgram(advancedTwin, "return-pump", program);
    expect(() => setAdvancedOutletProgram(saved, "return-pump", { ...program, revision: 0 })).toThrow("stale");
    expect(() => setAdvancedOutletProgram(saved, "return-pump", { ...program, name: "Conflict" })).toThrow("conflicts");
  });
});

describe("setDoserCalibration", () => {
  it("stores calibration independently on each doser", () => {
    const dosingTwin = setEquipmentProgramType(
      twin,
      "return-pump",
      "dosing-pump",
    );
    const calibration = {
      millilitersPerMinute: 42.5,
      calibratedAt: "2026-07-21T18:00:00.000Z",
      recalibrationMonths: 6 as const,
      dueAt: "2027-01-21T18:00:00.000Z",
    };

    const updated = setDoserCalibration(
      dosingTwin,
      "return-pump",
      calibration,
    );

    expect(updated.equipment[0]?.doserCalibration).toEqual(calibration);
    expect(dosingTwin.equipment[0]?.doserCalibration).toBeUndefined();
  });

  it("rejects calibration on non-doser equipment", () => {
    expect(() =>
      setDoserCalibration(twin, "return-pump", {
        millilitersPerMinute: 42.5,
        calibratedAt: "2026-07-21T18:00:00.000Z",
        recalibrationMonths: 6,
        dueAt: "2027-01-21T18:00:00.000Z",
      }),
    ).toThrow("Equipment is not configured as a doser");
  });
});

describe("doser measurement association", () => {
  it("stores the measured parameter on the doser", () => {
    const updated = updateEquipmentDetails(twin, "return-pump", {
      name: "Alkalinity Doser",
      role: "doser",
      dosingParameter: "alkalinity",
    });

    expect(updated.equipment[0]?.dosingParameter).toBe("alkalinity");
    expect(twin.equipment[0]?.dosingParameter).toBeUndefined();
  });

  it("stores a free-form dosing category", () => {
    const updated = updateEquipmentDetails(twin, "return-pump", {
      name: "Trace Doser",
      role: "doser",
      dosingParameter: "other",
      dosingParameterName: "Trace Elements",
    });

    expect(updated.equipment[0]).toMatchObject({
      dosingParameter: "other",
      dosingParameterName: "Trace Elements",
    });
  });
});

describe("getDosingRuntimeSeconds", () => {
  const calibration = {
    millilitersPerMinute: 42.5,
    calibratedAt: "2026-07-21T18:00:00.000Z",
    recalibrationMonths: 6 as const,
    dueAt: "2027-01-21T18:00:00.000Z",
  };

  it("rounds runtime up so a dose is not cut short", () => {
    expect(getDosingRuntimeSeconds(calibration, 10)).toBe(15);
  });

  it("keeps very small doses to the one-second device minimum", () => {
    expect(getDosingRuntimeSeconds(calibration, 0.1)).toBe(1);
  });

  it("rejects invalid dose amounts", () => {
    expect(() => getDosingRuntimeSeconds(calibration, 0)).toThrow(
      "Dose and calibration rate must be positive numbers",
    );
  });
});
