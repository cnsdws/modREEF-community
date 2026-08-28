import { describe, expect, it } from "vitest";
import type { Equipment } from "@modreef/digital-twin";
import {
  equipmentWithRequestedControlMode,
  applyPendingEquipmentControlModes,
} from "../src/equipmentControlModeReconciliation.js";

const doser: Equipment = {
  id: "doser-ca",
  aquariumId: "reef-1",
  name: "Ca Doser",
  role: "doser",
  enabled: true,
  controlMode: "on",
  programType: "dosing-pump",
  connectionStatus: "online",
  healthStatus: "normal",
};

describe("tablet equipment control-mode reconciliation", () => {
  it("keeps a requested OFF state across a stale dashboard refresh", () => {
    const result = applyPendingEquipmentControlModes(
      [doser],
      new Map([[doser.id, "off"]]),
    );
    expect(result[0]).toMatchObject({ controlMode: "off", enabled: false });
  });

  it("preserves an already matching controller report", () => {
    const reported = equipmentWithRequestedControlMode(doser, "off");
    const result = applyPendingEquipmentControlModes(
      [reported],
      new Map([[doser.id, "off"]]),
    );
    expect(result[0]).toBe(reported);
  });
});
