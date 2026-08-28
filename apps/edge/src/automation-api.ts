import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import type { RoutineDefinitionInput } from "@modreef/automation";

import { isOnboardingAuthorized } from "./onboarding-api.js";

import {
  completeFeedMode,
  completeWaterChange,
  cancelCustomRoutine,
  createCustomRoutine,
  deleteCustomRoutine,
  finishCustomRoutine,
  getActiveFeedMode,
  getActiveCustomRoutine,
  getActiveWaterChange,
  getCustomRoutines,
  getWaterChangeRoutine,
  startCustomRoutine,
  startFeedMode,
  startWaterChange,
  updateCustomRoutine,
  updateWaterChangeRoutine,
} from "./automation-runtime.js";

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

export async function handleAutomationRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const pathname = new URL(request.url ?? "/", "http://edge").pathname;
  const isFeedMode = pathname === "/modes/feed";
  const isWaterChange = pathname === "/routines/water-change";
  const isCustomCollection = pathname === "/routines/custom";
  const isCustomActive = pathname === "/routines/custom/active";
  const isCustomFinish = pathname === "/routines/custom/active/finish";
  const customRunMatch = pathname.match(/^\/routines\/custom\/([^/]+)\/run$/);
  const customItemMatch = pathname.match(/^\/routines\/custom\/([^/]+)$/);
  const isCustomRoutine =
    isCustomCollection ||
    isCustomActive ||
    isCustomFinish ||
    customRunMatch ||
    customItemMatch;

  if (!isFeedMode && !isWaterChange && !isCustomRoutine) {
    return false;
  }

  if (!isOnboardingAuthorized(request)) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  if (isCustomCollection && request.method === "GET") {
    response.writeHead(200);
    response.end(
      JSON.stringify({
        routines: getCustomRoutines(),
        active: getActiveCustomRoutine() ?? null,
      }),
    );
    return true;
  }

  if (isCustomCollection && request.method === "POST") {
    const body = await readJson(request) as RoutineDefinitionInput;
    try {
      const routine = createCustomRoutine(body);
      response.writeHead(201);
      response.end(JSON.stringify({ routine }));
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return true;
  }

  if (isCustomActive && request.method === "DELETE") {
    await cancelCustomRoutine();
    response.writeHead(200);
    response.end(JSON.stringify({ active: null }));
    return true;
  }

  if (isCustomActive && request.method === "GET") {
    response.writeHead(200);
    response.end(
      JSON.stringify({ active: getActiveCustomRoutine() ?? null }),
    );
    return true;
  }

  if (isCustomFinish && request.method === "POST") {
    try {
      await finishCustomRoutine();
      response.writeHead(200);
      response.end(
        JSON.stringify({ active: getActiveCustomRoutine() ?? null }),
      );
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return true;
  }

  if (customRunMatch && request.method === "POST") {
    const routineId = decodeURIComponent(customRunMatch[1]!);

    if (!getCustomRoutines().some((item) => item.id === routineId)) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Routine not found" }));
      return true;
    }

    const active = await startCustomRoutine(
      routineId,
    );
    response.writeHead(200);
    response.end(JSON.stringify({ active: active ?? null }));
    return true;
  }

  if (customItemMatch) {
    const routineId = decodeURIComponent(customItemMatch[1]!);
    const existing = getCustomRoutines().find((item) => item.id === routineId);

    if (request.method === "GET") {
      if (!existing) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Routine not found" }));
      } else {
        response.writeHead(200);
        response.end(JSON.stringify({ routine: existing }));
      }
      return true;
    }

    if (request.method === "PUT") {
      if (!existing) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Routine not found" }));
        return true;
      }

      const body = await readJson(request) as RoutineDefinitionInput;
      try {
        const routine = updateCustomRoutine(routineId, body);
        response.writeHead(200);
        response.end(JSON.stringify({ routine }));
      } catch (error) {
        response.writeHead(400);
        response.end(JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return true;
    }

    if (request.method === "DELETE") {
      if (!existing) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Routine not found" }));
        return true;
      }

      deleteCustomRoutine(routineId);
      response.writeHead(204);
      response.end();
      return true;
    }
  }

  if (isCustomRoutine) {
    response.writeHead(405);
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  if (request.method === "GET") {
    response.writeHead(200);
    response.end(
      JSON.stringify({
        active: isFeedMode
          ? getActiveFeedMode() ?? null
          : getActiveWaterChange() ?? null,
        ...(isWaterChange
          ? { routine: getWaterChangeRoutine() ?? null }
          : {}),
      }),
    );
    return true;
  }

  if (request.method === "PUT" && isWaterChange) {
    const body = await readJson(request) as RoutineDefinitionInput;

    try {
      const routine = updateWaterChangeRoutine(body);
      response.writeHead(200);
      response.end(JSON.stringify({ routine }));
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }));
    }
    return true;
  }

  if (request.method === "POST" && isWaterChange) {
    const plan = await startWaterChange();

    response.writeHead(200);
    response.end(JSON.stringify({ active: plan }));
    return true;
  }

  if (request.method === "POST" && isFeedMode) {
    const body = await readJson(request);

    if (
      typeof body !== "object" ||
      body === null ||
      (
        "durationSeconds" in body &&
        typeof body.durationSeconds !== "number"
      ) ||
      (
        "skimmerRestartDelaySeconds" in body &&
        typeof body.skimmerRestartDelaySeconds !== "number"
      ) ||
      (
        "cycleId" in body &&
        body.cycleId !== "A" && body.cycleId !== "B" && body.cycleId !== "C"
      )
    ) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Feed Mode durations must be numbers",
        }),
      );
      return true;
    }

    const durationSeconds =
      "durationSeconds" in body
        ? body.durationSeconds as number
        : 300;
    const skimmerRestartDelaySeconds =
      "skimmerRestartDelaySeconds" in body
        ? body.skimmerRestartDelaySeconds as number
        : 120;
    const cycleId = "cycleId" in body
      ? body.cycleId as "A" | "B" | "C"
      : undefined;

    const plan = await startFeedMode(
      durationSeconds,
      skimmerRestartDelaySeconds,
      cycleId,
    );

    response.writeHead(200);
    response.end(JSON.stringify({ active: plan }));
    return true;
  }

  if (request.method === "DELETE") {
    if (isFeedMode) {
      const active = await completeFeedMode("cancelled");
      response.writeHead(200);
      response.end(JSON.stringify({ active: active ?? null }));
      return true;
    } else {
      await completeWaterChange();
    }

    response.writeHead(200);
    response.end(JSON.stringify({ active: null }));
    return true;
  }

  response.writeHead(405);
  response.end(JSON.stringify({ error: "Method not allowed" }));
  return true;
}
