import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import { isOnboardingAuthorized } from "./onboarding-api.js";
import {
  deletePhysicalDevice,
  getTwin,
  renamePhysicalDevice,
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

export async function handleManagedDeviceRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (!request.url?.startsWith("/managed-devices")) {
    return false;
  }

  if (!isOnboardingAuthorized(request)) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return true;
  }

  if (
    request.method === "GET" &&
    request.url === "/managed-devices"
  ) {
    response.writeHead(200);
    response.end(
      JSON.stringify({ devices: getTwin().devices ?? [] }),
    );
    return true;
  }

  const match = /^\/managed-devices\/([^/]+)$/.exec(
    request.url ?? "",
  );

  if (request.method === "PATCH" && match?.[1]) {
    const deviceId = decodeURIComponent(match[1]);
    const body = await readJson(request);
    const name =
      typeof body === "object" &&
      body !== null &&
      "name" in body &&
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    if (!name || name.length > 48) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error: "Device name must be between 1 and 48 characters",
        }),
      );
      return true;
    }

    const device = getTwin().devices?.find(
      (candidate) => candidate.id === deviceId,
    );

    if (!device) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Device not found" }));
      return true;
    }

    renamePhysicalDevice(deviceId, name);

    response.writeHead(200);
    response.end(
      JSON.stringify({
        device: {
          ...device,
          name,
        },
      }),
    );
    return true;
  }

  if (request.method === "DELETE" && match?.[1]) {
    const deviceId = decodeURIComponent(match[1]);
    const twin = getTwin();
    const device = twin.devices?.find(
      (candidate) => candidate.id === deviceId,
    );

    if (!device) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Device not found" }));
      return true;
    }

    const affectedEquipment = twin.equipment
      .filter(
        (equipment) =>
          equipment.physicalDeviceId === deviceId ||
          equipment.binding?.deviceId === deviceId,
      )
      .map((equipment) => ({
        id: equipment.id,
        name: equipment.name,
      }));

    await deletePhysicalDevice(deviceId);

    response.writeHead(200);
    response.end(
      JSON.stringify({
        deletedDevice: {
          id: device.id,
          name: device.name,
        },
        deletedEquipment: affectedEquipment,
      }),
    );
    return true;
  }

  return false;
}
