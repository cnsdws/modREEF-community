import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import { isOnboardingAuthorized } from "./onboarding-api.js";
import {
  getTwin,
  updateAquariumName,
} from "./equipment-runtime.js";

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

export async function handleAquariumRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (request.url !== "/aquarium") {
    return false;
  }

  if (!isOnboardingAuthorized(request)) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  if (request.method === "GET") {
    response.writeHead(200);
    response.end(
      JSON.stringify({ aquarium: getTwin().aquarium }),
    );
    return true;
  }

  if (request.method === "PUT") {
    const body = await readJson(request);

    if (
      typeof body !== "object" ||
      body === null ||
      !("name" in body) ||
      typeof body.name !== "string"
    ) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Body must contain an aquarium name",
        }),
      );
      return true;
    }

    const name = body.name.trim();

    if (name.length < 1 || name.length > 80) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Aquarium name must be between 1 and 80 characters",
        }),
      );
      return true;
    }

    const updated = updateAquariumName(name);

    response.writeHead(200);
    response.end(
      JSON.stringify({ aquarium: updated.aquarium }),
    );
    return true;
  }

  response.writeHead(405);
  response.end(JSON.stringify({ error: "Method not allowed" }));
  return true;
}
