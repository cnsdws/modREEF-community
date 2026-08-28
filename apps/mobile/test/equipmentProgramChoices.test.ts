import { describe, expect, it } from "vitest";

import { equipmentProgramChoices } from "../src/equipmentProgramChoices";

describe("equipment program choices", () => {
  it("keeps safety-critical equipment programs editable", () => {
    expect(equipmentProgramChoices.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "always-on",
        "schedule",
        "heater",
        "return-pump",
        "skimmer",
        "dosing-pump",
        "advanced",
      ]),
    );
  });
});
