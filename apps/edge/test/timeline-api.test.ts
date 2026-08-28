import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import { describe, expect, it } from "vitest";

import {
  createAquariumEvent,
  handleTimelineRequest,
} from "../src/timeline-api.js";

function createResponse() {
  let statusCode: number | undefined;
  let body = "";

  const response = {
    writeHead(code: number) {
      statusCode = code;
      return response;
    },
    end(value?: string) {
      body = value ?? "";
      return response;
    },
  } as unknown as ServerResponse;

  return {
    response,
    statusCode: () => statusCode,
    body: () => body,
  };
}

describe("timeline event creation", () => {
  it("creates a server-owned measurement event", () => {
    const event = createAquariumEvent(
      "reef",
      {
        type: "measurement",
        parameter: "alkalinity",
        value: 8.3,
        unit: "dKH",
        source: "manual",
        testKit: {
          brand: "Salifert",
          rawReading: 0.42,
        },
      },
      new Date("2026-07-20T12:00:00Z"),
    );

    expect(event).toMatchObject({
      aquariumId: "reef",
      type: "measurement",
      parameter: "alkalinity",
      value: 8.3,
      unit: "dKH",
      source: "manual",
      recordedAt: "2026-07-20T12:00:00.000Z",
    });
    expect(event.id).toEqual(expect.any(String));
  });

  it("records products that do not have direct tests", () => {
    const event = createAquariumEvent(
      "reef",
      {
        type: "dose",
        product: "AcroPower",
        category: "amino-acid",
        amount: 5,
        unit: "mL",
        method: "manual",
      },
      new Date("2026-07-20T13:00:00Z"),
    );

    expect(event).toMatchObject({
      type: "dose",
      product: "AcroPower",
      category: "amino-acid",
      amount: 5,
      unit: "mL",
    });
  });

  it("preserves multi-part test-kit readings", () => {
    const event = createAquariumEvent("reef", {
      type: "measurement",
      parameter: "calcium",
      value: 450,
      unit: "ppm",
      source: "manual",
      testKit: {
        brand: "Elos",
        product: "AquaTest Ca",
        rawReading: 8,
        secondaryRawReading: 5,
      },
    });

    expect(event).toMatchObject({
      testKit: {
        brand: "Elos",
        rawReading: 8,
        secondaryRawReading: 5,
      },
    });
  });

  it("creates named custom measurements", () => {
    const event = createAquariumEvent("reef", {
      type: "measurement",
      parameter: "other",
      name: "Strontium",
      value: 8.1,
      unit: "ppm",
      source: "manual",
    });

    expect(event).toMatchObject({
      type: "measurement",
      parameter: "other",
      name: "Strontium",
      value: 8.1,
      unit: "ppm",
    });
  });

  it("creates iron measurements", () => {
    const event = createAquariumEvent("reef", {
      type: "measurement",
      parameter: "iron",
      value: 0.05,
      unit: "ppm",
      source: "manual",
    });

    expect(event).toMatchObject({
      type: "measurement",
      parameter: "iron",
      value: 0.05,
      unit: "ppm",
    });
  });

  it("requires a name for custom measurements", () => {
    expect(() =>
      createAquariumEvent("reef", {
        type: "measurement",
        parameter: "other",
        value: 8.1,
        unit: "ppm",
      }),
    ).toThrow("name is required for other measurements");
  });

  it("records an acknowledged alert in aquarium history", () => {
    const event = createAquariumEvent(
      "reef",
      {
        type: "activity",
        category: "alert",
        action: "acknowledged",
        title: "Acknowledged alert: Return Pump is offline",
        details: "Confirm power and connectivity.",
        source: "manual",
      },
      new Date("2026-07-23T12:00:00Z"),
    );

    expect(event).toMatchObject({
      type: "activity",
      category: "alert",
      action: "acknowledged",
      source: "manual",
      recordedAt: "2026-07-23T12:00:00.000Z",
    });
  });

  it("rejects invalid dose amounts", () => {
    expect(() =>
      createAquariumEvent("reef", {
        type: "dose",
        product: "Trace Elements",
        category: "trace-element",
        amount: -1,
        unit: "mL",
        method: "manual",
      }),
    ).toThrow("amount must be a valid number");
  });
});

describe("timeline API authorization", () => {
  it("rejects requests without a paired-app token", async () => {
    const request = {
      method: "GET",
      url: "/aquarium/events",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleTimelineRequest(request, result.response),
    ).toBe(true);
    expect(result.statusCode()).toBe(401);
    expect(JSON.parse(result.body())).toEqual({
      error: "Unauthorized",
    });
  });

  it("does not intercept unrelated routes", async () => {
    const request = {
      method: "GET",
      url: "/health",
      headers: {},
    } as IncomingMessage;
    const result = createResponse();

    expect(
      await handleTimelineRequest(request, result.response),
    ).toBe(false);
    expect(result.statusCode()).toBeUndefined();
  });
});
