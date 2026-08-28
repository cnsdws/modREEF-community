import { randomUUID } from "node:crypto";
import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import type {
  ActivityCategory,
  AquariumEvent,
  AquariumEventSource,
  DoseCategory,
  WaterParameter,
} from "@modreef/digital-twin";

import {
  getTwin,
  runtimeStore,
} from "./equipment-runtime.js";
import { isOnboardingAuthorized } from "./onboarding-api.js";

const eventSources = new Set<AquariumEventSource>([
  "manual",
  "sensor",
  "automation",
  "imported",
]);

const waterParameters = new Set<WaterParameter>([
  "temperature",
  "salinity",
  "ph",
  "orp",
  "alkalinity",
  "calcium",
  "magnesium",
  "potassium",
  "iodine",
  "nitrate",
  "phosphate",
  "iron",
  "other",
]);

const doseCategories = new Set<DoseCategory>([
  "alkalinity",
  "calcium",
  "magnesium",
  "potassium",
  "nitrate",
  "phosphate",
  "amino-acid",
  "trace-element",
  "other",
]);

const activityCategories = new Set<ActivityCategory>([
  "equipment",
  "automation",
  "feed-cycle",
  "routine",
  "alert",
]);

function optionalProperty<K extends string, V>(
  key: K,
  value: V | undefined,
): {} | Record<K, V> {
  return value === undefined
    ? {}
    : ({ [key]: value } as Record<K, V>);
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  maximumLength = 200,
): string {
  const value = body[key];

  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > maximumLength
  ) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value.trim();
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  maximumLength = 2000,
): string | undefined {
  const value = body[key];

  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.trim().length > maximumLength
  ) {
    throw new Error(`${key} must be a string`);
  }

  return value.trim() || undefined;
}

function requiredNumber(
  body: Record<string, unknown>,
  key: string,
  positiveOnly = false,
): number {
  const value = body[key];

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (positiveOnly && value <= 0)
  ) {
    throw new Error(`${key} must be a valid number`);
  }

  return value;
}

async function readJson(
  request: IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function createAquariumEvent(
  aquariumId: string,
  value: unknown,
  now = new Date(),
): AquariumEvent {
  if (!isRecord(value)) {
    throw new Error("Event body must be an object");
  }

  const type = requiredString(value, "type", 40);
  const occurredAt =
    optionalString(value, "occurredAt", 40) ??
    now.toISOString();

  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("occurredAt must be an ISO date");
  }

  const sourceValue = value.source ?? "manual";

  if (
    typeof sourceValue !== "string" ||
    !eventSources.has(sourceValue as AquariumEventSource)
  ) {
    throw new Error("source is invalid");
  }

  const notes = optionalString(value, "notes");

  const common = {
    id: randomUUID(),
    aquariumId,
    occurredAt,
    recordedAt: now.toISOString(),
    source: sourceValue as AquariumEventSource,
    ...(notes === undefined ? {} : { notes }),
  };

  if (type === "measurement") {
    const parameter = requiredString(value, "parameter", 40);

    if (!waterParameters.has(parameter as WaterParameter)) {
      throw new Error("parameter is invalid");
    }

    const name = optionalString(value, "name", 100);

    if (parameter === "other" && name === undefined) {
      throw new Error("name is required for other measurements");
    }

    const testKitValue = value.testKit;
    let testKit:
      | {
          brand: string;
          product?: string;
          lot?: string;
          rawReading?: number;
          secondaryRawReading?: number;
          resolution?: string;
        }
      | undefined;

    if (testKitValue !== undefined) {
      if (!isRecord(testKitValue)) {
        throw new Error("testKit must be an object");
      }

      const rawReading = testKitValue.rawReading;
      const secondaryRawReading = testKitValue.secondaryRawReading;

      if (
        rawReading !== undefined &&
        (typeof rawReading !== "number" ||
          !Number.isFinite(rawReading))
      ) {
        throw new Error(
          "testKit.rawReading must be a valid number",
        );
      }

      if (
        secondaryRawReading !== undefined &&
        (typeof secondaryRawReading !== "number" ||
          !Number.isFinite(secondaryRawReading))
      ) {
        throw new Error(
          "testKit.secondaryRawReading must be a valid number",
        );
      }

      const product = optionalString(
        testKitValue,
        "product",
        100,
      );
      const lot = optionalString(testKitValue, "lot", 100);
      const resolution = optionalString(
        testKitValue,
        "resolution",
        100,
      );

      testKit = {
        brand: requiredString(testKitValue, "brand", 100),
        ...(product === undefined ? {} : { product }),
        ...(lot === undefined ? {} : { lot }),
        ...(rawReading === undefined ? {} : { rawReading }),
        ...(secondaryRawReading === undefined
          ? {}
          : { secondaryRawReading }),
        ...(resolution === undefined ? {} : { resolution }),
      };
    }

    return {
      ...common,
      type,
      parameter: parameter as WaterParameter,
      ...(name === undefined ? {} : { name }),
      value: requiredNumber(value, "value"),
      unit: requiredString(value, "unit", 40),
      ...(testKit === undefined ? {} : { testKit }),
    };
  }

  if (type === "dose") {
    const category = requiredString(value, "category", 40);
    const method = requiredString(value, "method", 40);

    if (!doseCategories.has(category as DoseCategory)) {
      throw new Error("category is invalid");
    }

    if (method !== "manual" && method !== "dosing-pump") {
      throw new Error("method is invalid");
    }

    return {
      ...common,
      type,
      product: requiredString(value, "product"),
      category: category as DoseCategory,
      amount: requiredNumber(value, "amount", true),
      unit: requiredString(value, "unit", 40),
      method,
      ...optionalProperty(
        "equipmentId",
        optionalString(value, "equipmentId", 100),
      ),
    };
  }

  if (type === "feeding") {
    const method = requiredString(value, "method", 40);

    if (method !== "manual" && method !== "automatic") {
      throw new Error("method is invalid");
    }

    const amount = value.amount;

    if (
      amount !== undefined &&
      (typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0)
    ) {
      throw new Error("amount must be a positive number");
    }

    return {
      ...common,
      type,
      food: requiredString(value, "food"),
      ...optionalProperty("amount", amount),
      ...optionalProperty(
        "unit",
        optionalString(value, "unit", 40),
      ),
      method,
      ...optionalProperty(
        "equipmentId",
        optionalString(value, "equipmentId", 100),
      ),
    };
  }

  if (type === "maintenance") {
    return {
      ...common,
      type,
      activity: requiredString(value, "activity"),
      ...optionalProperty(
        "details",
        optionalString(value, "details"),
      ),
    };
  }

  if (type === "observation") {
    return {
      ...common,
      type,
      observation: requiredString(
        value,
        "observation",
        4000,
      ),
      ...optionalProperty(
        "category",
        optionalString(value, "category", 100),
      ),
    };
  }

  if (type === "activity") {
    const category = requiredString(value, "category", 40);

    if (!activityCategories.has(category as ActivityCategory)) {
      throw new Error("category is invalid");
    }

    return {
      ...common,
      type,
      category: category as ActivityCategory,
      action: requiredString(value, "action", 100),
      title: requiredString(value, "title"),
      ...optionalProperty(
        "details",
        optionalString(value, "details"),
      ),
      ...optionalProperty(
        "equipmentId",
        optionalString(value, "equipmentId", 100),
      ),
      ...optionalProperty(
        "alertId",
        optionalString(value, "alertId", 200),
      ),
    };
  }

  throw new Error("Unsupported event type");
}

export async function handleTimelineRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const url = new URL(
    request.url ?? "/",
    "http://modreef.local",
  );

  const eventsPath = "/aquarium/events";
  const eventPathPrefix = `${eventsPath}/`;
  const eventId = url.pathname.startsWith(eventPathPrefix)
    ? decodeURIComponent(url.pathname.slice(eventPathPrefix.length))
    : undefined;

  if (url.pathname !== eventsPath && eventId === undefined) {
    return false;
  }

  if (!isOnboardingAuthorized(request)) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  const aquariumId = getTwin().aquarium.id;

  if (request.method === "PUT" && eventId) {
    try {
      const replacement = createAquariumEvent(
        aquariumId,
        await readJson(request),
      );
      const event = {
        ...replacement,
        id: eventId,
      } as AquariumEvent;
      const updated = runtimeStore.updateEvent(event);

      if (!updated) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Event not found" }));
        return true;
      }

      response.writeHead(200);
      response.end(JSON.stringify({ event }));
    } catch (error) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }),
      );
    }

    return true;
  }

  if (request.method === "DELETE" && eventId) {
    const deleted = runtimeStore.deleteEvent(aquariumId, eventId);

    if (!deleted) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Event not found" }));
      return true;
    }

    response.writeHead(204);
    response.end();
    return true;
  }

  if (url.pathname !== eventsPath) {
    response.writeHead(405);
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  if (request.method === "GET") {
    const requestedLimit = url.searchParams.get("limit");
    const limit =
      requestedLimit === null ? 100 : Number(requestedLimit);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "limit must be between 1 and 1000",
        }),
      );
      return true;
    }

    response.writeHead(200);
    response.end(
      JSON.stringify({
        events: runtimeStore.listEvents(aquariumId, limit),
      }),
    );
    return true;
  }

  if (request.method === "POST") {
    try {
      const event = createAquariumEvent(
        aquariumId,
        await readJson(request),
      );

      runtimeStore.appendEvent(event);

      response.writeHead(201);
      response.end(JSON.stringify({ event }));
    } catch (error) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }),
      );
    }

    return true;
  }

  response.writeHead(405);
  response.end(JSON.stringify({ error: "Method not allowed" }));
  return true;
}
