import { describe, expect, it } from "vitest";
import type { AquariumEvent } from "@modreef/digital-twin";
import { filterJournalEvents } from "../src/journalFiltering.js";

const events: AquariumEvent[] = [
  { id: "ca", aquariumId: "reef", type: "measurement", parameter: "calcium",
    value: 440, unit: "ppm", source: "manual", occurredAt: "2026-08-06T12:00:00Z",
    recordedAt: "2026-08-06T12:00:01Z", notes: "Salifert result" },
  { id: "dose", aquariumId: "reef", type: "activity", category: "automation",
    action: "dose-completed", title: "Ca Doser dosed 7 mL", source: "automation",
    occurredAt: "2026-08-06T13:00:00Z", recordedAt: "2026-08-06T13:00:01Z" },
  { id: "note", aquariumId: "reef", type: "observation", observation: "Coral looks open",
    source: "manual", occurredAt: "2026-08-06T14:00:00Z",
    recordedAt: "2026-08-06T14:00:01Z" },
];

describe("journal filtering", () => {
  it("searches across event details with all terms", () => {
    expect(filterJournalEvents(events, "all", "calcium salifert").map(({ id }) => id))
      .toEqual(["ca"]);
  });

  it("groups automated dosing activity with dosing entries", () => {
    expect(filterJournalEvents(events, "dose", "7 ml").map(({ id }) => id))
      .toEqual(["dose"]);
  });

  it("filters observations as notes", () => {
    expect(filterJournalEvents(events, "note", "").map(({ id }) => id))
      .toEqual(["note"]);
  });
});
