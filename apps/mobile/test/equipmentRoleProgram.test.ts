import { describe, expect, it } from "vitest";

import {
  equipmentRoleLabel,
  programTypeForEquipmentRole,
} from "../src/equipmentRoleProgram";

describe("equipment role programs", () => {
  it("selects the matching AUTO program for specialized equipment", () => {
    expect(programTypeForEquipmentRole("return-pump")).toBe("return-pump");
    expect(programTypeForEquipmentRole("skimmer")).toBe("skimmer");
    expect(programTypeForEquipmentRole("heater")).toBe("heater");
    expect(programTypeForEquipmentRole("doser")).toBe("dosing-pump");
    expect(programTypeForEquipmentRole("light")).toBe("light-schedule");
  });

  it("does not overwrite programs for generic equipment roles", () => {
    expect(programTypeForEquipmentRole("outlet")).toBeNull();
    expect(programTypeForEquipmentRole("other")).toBeNull();
  });

  it("uses established uppercase abbreviations for UV and ATO", () => {
    expect(equipmentRoleLabel("uv")).toBe("UV");
    expect(equipmentRoleLabel("ato")).toBe("ATO");
    expect(equipmentRoleLabel("return-pump")).toBe("Return Pump");
  });
});
