import { describe, expect, it } from "vitest";

import type {
  AquariumDigitalTwin,
  AquariumEvent,
} from "@modreef/digital-twin";

import { SqliteTwinStore } from "../src/index.js";

function createTwin(): AquariumDigitalTwin {
  return {
    aquarium: {
      id: "reef",
      name: "Test Reef",
      description: "Persistence test",
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
}

describe("SqliteTwinStore", () => {
  it("returns undefined when no twin exists", () => {
    const store = new SqliteTwinStore(":memory:");

    expect(store.load("reef")).toBeUndefined();

    store.close();
  });

  it("saves and reloads a digital twin", () => {
    const store = new SqliteTwinStore(":memory:");
    const twin = createTwin();

    store.save(twin);

    expect(store.load("reef")).toEqual(twin);

    store.close();
  });

  it("updates an existing digital twin", () => {
    const store = new SqliteTwinStore(":memory:");
    const twin = createTwin();

    store.save(twin);
    store.save({
      ...twin,
      equipment: twin.equipment.map((equipment) => ({
        ...equipment,
        enabled: false,
      })),
    });

    expect(store.load("reef")?.equipment[0]?.enabled).toBe(false);

    store.close();
  });
});

describe("runtime state", () => {
  it("saves, loads, and deletes automation state", () => {
    const store = new SqliteTwinStore(":memory:");
    const state = {
      intent: "feed-mode",
      endsAt: "2026-07-16T12:05:00Z",
    };

    store.saveState("active-feed-mode", state);

    expect(
      store.loadState("active-feed-mode"),
    ).toEqual(state);

    store.deleteState("active-feed-mode");

    expect(
      store.loadState("active-feed-mode"),
    ).toBeUndefined();

    store.close();
  });
});


describe("aquarium timeline", () => {
  it("pages events forward from a durable cursor", () => {
    const store = new SqliteTwinStore(":memory:");
    const events = ["a", "b", "c"].map((id, index): AquariumEvent => ({
      id,
      aquariumId: "reef",
      type: "observation",
      observation: id,
      occurredAt: `2026-07-20T13:00:0${index}Z`,
      recordedAt: index < 2 ? "2026-07-20T14:00:00Z" : "2026-07-20T14:00:01Z",
      source: "manual",
    }));
    events.forEach((event) => store.appendEvent(event));

    expect(store.listEventsAfter("reef", undefined, 2)).toEqual(events.slice(0, 2));
    expect(store.listEventsAfter("reef", {
      recordedAt: events[1]!.recordedAt,
      eventId: events[1]!.id,
    })).toEqual(events.slice(2));
    store.close();
  });

  it("appends and returns newest events first", () => {
    const store = new SqliteTwinStore(":memory:");

    const measurement: AquariumEvent = {
      id: "measurement-1",
      aquariumId: "reef",
      type: "measurement",
      parameter: "alkalinity",
      value: 8.2,
      unit: "dKH",
      occurredAt: "2026-07-20T10:00:00Z",
      recordedAt: "2026-07-20T10:01:00Z",
      source: "manual",
      testKit: {
        brand: "Salifert",
        rawReading: 0.42,
        resolution: "high",
      },
      notes: "Color change was clear.",
    };

    const dose: AquariumEvent = {
      id: "dose-1",
      aquariumId: "reef",
      type: "dose",
      product: "AcroPower",
      category: "amino-acid",
      amount: 5,
      unit: "mL",
      method: "manual",
      occurredAt: "2026-07-20T11:00:00Z",
      recordedAt: "2026-07-20T11:00:00Z",
      source: "manual",
    };

    store.appendEvent(measurement);
    store.appendEvent(dose);

    expect(store.listEvents("reef")).toEqual([
      dose,
      measurement,
    ]);

    store.close();
  });

  it("keeps aquarium timelines isolated", () => {
    const store = new SqliteTwinStore(":memory:");

    const event: AquariumEvent = {
      id: "feeding-1",
      aquariumId: "reef-a",
      type: "feeding",
      food: "Frozen mysis",
      method: "manual",
      occurredAt: "2026-07-20T12:00:00Z",
      recordedAt: "2026-07-20T12:00:00Z",
      source: "manual",
    };

    store.appendEvent(event);

    expect(store.listEvents("reef-a")).toEqual([event]);
    expect(store.listEvents("reef-b")).toEqual([]);

    store.close();
  });

  it("does not overwrite an existing event", () => {
    const store = new SqliteTwinStore(":memory:");

    const event: AquariumEvent = {
      id: "observation-1",
      aquariumId: "reef",
      type: "observation",
      observation: "Coral polyp extension looks improved.",
      occurredAt: "2026-07-20T13:00:00Z",
      recordedAt: "2026-07-20T13:00:00Z",
      source: "manual",
    };

    store.appendEvent(event);

    expect(() => store.appendEvent(event)).toThrow();
    expect(store.listEvents("reef")).toEqual([event]);

    store.close();
  });
});
