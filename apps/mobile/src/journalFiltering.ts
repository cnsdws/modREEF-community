import type { AquariumEvent } from "@modreef/digital-twin";

export type JournalFilter =
  | "all"
  | "test"
  | "dose"
  | "feed"
  | "maintenance"
  | "note"
  | "system";

export const journalFilters: Array<{ id: JournalFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "test", label: "Tests" },
  { id: "dose", label: "Dosing" },
  { id: "feed", label: "Feeding" },
  { id: "maintenance", label: "Maintenance" },
  { id: "note", label: "Notes" },
  { id: "system", label: "System" },
];

function matchesFilter(event: AquariumEvent, filter: JournalFilter): boolean {
  if (filter === "all") return true;
  if (filter === "test") return event.type === "measurement";
  if (filter === "dose") {
    return event.type === "dose" ||
      (event.type === "activity" &&
        /dos/i.test(`${event.category} ${event.action} ${event.title}`));
  }
  if (filter === "feed") {
    return event.type === "feeding" ||
      (event.type === "activity" && /feed/i.test(event.category));
  }
  if (filter === "maintenance") return event.type === "maintenance";
  if (filter === "note") return event.type === "observation";
  return event.type === "activity" &&
    !/dos|feed/i.test(`${event.category} ${event.action} ${event.title}`);
}

function searchableText(event: AquariumEvent): string {
  const common = [event.type, event.source, event.notes, event.occurredAt];
  switch (event.type) {
    case "measurement":
      return [...common, event.name, event.parameter, event.value, event.unit,
        event.testKit?.brand, event.testKit?.product].join(" ");
    case "dose":
      return [...common, event.product, event.amount, event.unit].join(" ");
    case "feeding":
      return [...common, event.food, event.amount, event.unit].join(" ");
    case "maintenance":
      return [...common, event.activity, event.details].join(" ");
    case "observation":
      return [...common, event.observation, event.category].join(" ");
    case "activity":
      return [...common, event.title, event.category, event.action, event.details]
        .join(" ");
  }
}

export function filterJournalEvents(
  events: AquariumEvent[],
  filter: JournalFilter,
  query: string,
): AquariumEvent[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((event) => {
    if (!matchesFilter(event, filter)) return false;
    if (terms.length === 0) return true;
    const text = searchableText(event).toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
