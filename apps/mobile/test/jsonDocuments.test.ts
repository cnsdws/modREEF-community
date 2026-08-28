import { describe, expect, it } from "vitest";

import { jsonDocumentsEquivalent } from "../src/jsonDocuments.js";

describe("JSON document comparison", () => {
  it("ignores object key order while preserving array order and values", () => {
    expect(jsonDocumentsEquivalent(
      { enabled: true, rule: { time: "08:00", weekdays: [1, 2] } },
      { rule: { weekdays: [1, 2], time: "08:00" }, enabled: true },
    )).toBe(true);
    expect(jsonDocumentsEquivalent(
      { enabled: true, weekdays: [1, 2] },
      { weekdays: [2, 1], enabled: true },
    )).toBe(false);
  });
});
