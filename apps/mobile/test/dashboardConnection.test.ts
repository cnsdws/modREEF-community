import { describe, expect, it } from "vitest";
import { dashboardConnectionMode } from "../src/connectionMode.js";
import { measurementFromEvent } from "../src/measurementEvents.js";
import { edgeIsCurrentlyOnline } from "../src/cloudDeviceMutation.js";
import type { EdgeSummary } from "@modreef/api-contract";

describe("dashboard connection mode", () => {
  it("keeps local Edge mode as the safe default", () => {
    expect(dashboardConnectionMode(undefined)).toBe("cloud");
    expect(dashboardConnectionMode("unexpected")).toBe("cloud");
  });

  it("requires an explicit cloud selection", () => {
    expect(dashboardConnectionMode("cloud")).toBe("cloud");
  });
});

describe("cloud mutation ownership", () => {
  const edge = (status: EdgeSummary["status"], lastSeenAt: string): EdgeSummary => ({
    id: "edge-1", aquariumId: "reef-1", name: "Reef Controller 1",
    status, softwareVersion: "0.1.0", lastSeenAt, localHostname: "reef-controller.local",
    runtimeState: { feedCycle: null },
  });

  it("allows mutations only through a recently reporting online controller", () => {
    const now = Date.parse("2026-07-30T18:00:00Z");
    expect(edgeIsCurrentlyOnline(edge("online", "2026-07-30T17:59:30Z"), now)).toBe(true);
    expect(edgeIsCurrentlyOnline(edge("online", "2026-07-30T17:58:59Z"), now)).toBe(false);
    expect(edgeIsCurrentlyOnline(edge("offline", "2026-07-30T17:59:59Z"), now)).toBe(false);
  });
});

describe("dashboard measurements", () => {
  it("maps Edge measurement events into live dashboard readings", () => {
    expect(measurementFromEvent({
      id: "reading-1",
      aquariumId: "reef-1",
      type: "measurement",
      parameter: "ph",
      value: 8.17,
      unit: "",
      occurredAt: "2026-07-27T16:00:00.000Z",
      recordedAt: "2026-07-27T16:00:01.000Z",
      source: "sensor",
    }, "fallback")).toEqual({
      id: "reading-1",
      aquariumId: "reef-1",
      parameter: "ph",
      value: 8.17,
      unit: "",
      measuredAt: "2026-07-27T16:00:00.000Z",
      source: "sensor",
    });
  });

  it("accepts manual iron measurements", () => {
    expect(measurementFromEvent({
      id: "iron-1",
      aquariumId: "reef-1",
      type: "measurement",
      parameter: "iron",
      value: 0.05,
      unit: "ppm",
      occurredAt: "2026-08-02T18:00:00.000Z",
      source: "manual",
    }, "fallback")).toMatchObject({
      parameter: "iron",
      value: 0.05,
      unit: "ppm",
      source: "manual",
    });
  });

  it("rejects malformed and non-measurement events", () => {
    expect(measurementFromEvent({ type: "feeding" }, "reef-1")).toBeNull();
    expect(measurementFromEvent({
      id: "bad",
      type: "measurement",
      parameter: "ph",
      value: Number.NaN,
      unit: "",
      occurredAt: "not-a-date",
    }, "reef-1")).toBeNull();
  });
});
