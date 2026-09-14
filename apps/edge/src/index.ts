import { createServer } from "node:http";
import { hostname } from "node:os";
import { readFileSync } from "node:fs";

import {
  ArpDiscoveryProvider,
  DiscoveryManager,
  MdnsDiscoveryProvider,
} from "@modreef/discovery";
import { inspectDevice } from "@modreef/inspection";
import { handleEquipmentRequest } from "./equipment-api.js";
import { handleManagedDeviceRequest } from "./managed-device-api.js";
import { handleAquariumRequest } from "./aquarium-api.js";
import { handleTimelineRequest } from "./timeline-api.js";
import { handleAutomationRequest } from "./automation-api.js";
import { initializeAutomation } from "./automation-runtime.js";
import { handleOnboardingRequest } from "./onboarding-api.js";
import { createEdgeHealthSnapshot } from "./health-status.js";
import { createEdgeCloudSyncFromEnvironment } from "./cloud-sync.js";
import { EdgeCloudSync, type EdgeCloudConfig } from "./cloud-sync.js";
import {
  deleteCloudCredentials,
  loadCloudCredentials,
  saveCloudCredentials,
} from "./cloud-credential-store.js";
import { verifyCloudLocalAuthorization } from "./cloud-local-authorization.js";
import { controllerClaimSecretMatches } from "./controller-claim-secret.js";
import { deriveControllerSetupId } from "./controller-setup-id.js";
import { controllerSoftwareVersion } from "./software-version.js";

const port = Number(process.env.MODREEF_PORT ?? 3000);
const startedAt = Date.now();
let cloudSync = createEdgeCloudSyncFromEnvironment();
const consumedLocalAuthorizationNonces = new Map<string, number>();

function authorizeCloudClient(grant: string): boolean {
  const stored = loadCloudCredentials();
  const config = stored ?? (
    process.env.MODREEF_EDGE_ID && process.env.MODREEF_AQUARIUM_ID && process.env.MODREEF_EDGE_TOKEN
      ? {
          cloudUrl: process.env.MODREEF_CLOUD_URL ?? "https://api.modreef.net",
          edgeId: process.env.MODREEF_EDGE_ID,
          aquariumId: process.env.MODREEF_AQUARIUM_ID,
          token: process.env.MODREEF_EDGE_TOKEN,
        }
      : undefined
  );
  if (!config) return false;
  const verified = verifyCloudLocalAuthorization(grant, config);
  if (!verified) return false;
  const now = Date.now();
  for (const [nonce, expiresAt] of consumedLocalAuthorizationNonces) {
    if (expiresAt <= now) consumedLocalAuthorizationNonces.delete(nonce);
  }
  if (consumedLocalAuthorizationNonces.has(verified.nonce)) return false;
  consumedLocalAuthorizationNonces.set(verified.nonce, verified.expiresAtMs);
  return true;
}

function controllerSetupId(): string {
  let factorySetupId: unknown;
  try {
    const factoryIdentity = JSON.parse(
      readFileSync("/var/lib/modreef/factory-identity.json", "utf8"),
    ) as { setupId?: unknown };
    factorySetupId = factoryIdentity.setupId;
  } catch {
    // Development controllers may not have a factory identity yet.
  }
  let physicalSerial: string | undefined;
  try {
    physicalSerial = readFileSync(
      "/sys/firmware/devicetree/base/serial-number",
      "utf8",
    );
  } catch {
    // Non-Pi development systems fall back to their operating-system identity.
  }
  let fallbackIdentity = hostname();
  try {
    fallbackIdentity = readFileSync("/etc/machine-id", "utf8").trim() || fallbackIdentity;
  } catch {
    // Hostname is a safe fallback for development machines.
  }
  return deriveControllerSetupId({ factorySetupId, physicalSerial, fallbackIdentity });
}

function verifyControllerClaimSecret(claimSecret: string | undefined): void {
  let expectedHash: string | undefined;
  try {
    const factoryIdentity = JSON.parse(
      readFileSync("/var/lib/modreef/factory-identity.json", "utf8"),
    ) as { claimSecretHash?: unknown };
    if (typeof factoryIdentity.claimSecretHash === "string" && /^[a-f0-9]{64}$/.test(factoryIdentity.claimSecretHash)) {
      expectedHash = factoryIdentity.claimSecretHash;
    }
  } catch {
    // Unenrolled development controllers retain the existing LAN claim flow.
  }
  if (!controllerClaimSecretMatches(expectedHash, claimSecret)) {
    throw new Error("Reef Controller setup code was rejected");
  }
}

async function claimCloud(credentials: EdgeCloudConfig, claimSecret?: string): Promise<void> {
  if (cloudSync || loadCloudCredentials()) {
    throw new Error("This Reef Controller is already claimed");
  }
  verifyControllerClaimSecret(claimSecret);
  const candidate = new EdgeCloudSync(credentials);
  await candidate.runOnce();
  saveCloudCredentials(credentials);
  cloudSync = candidate;
  cloudSync.start();
  console.log("modREEF Reef Controller claimed and cloud synchronization enabled");
}

async function unclaimCloud(): Promise<void> {
  if (
    process.env.MODREEF_EDGE_ID ||
    process.env.MODREEF_AQUARIUM_ID ||
    process.env.MODREEF_EDGE_TOKEN
  ) {
    throw new Error(
      "This Reef Controller uses legacy system credentials and must be migrated before removal",
    );
  }
  cloudSync?.stop();
  cloudSync = undefined;
  deleteCloudCredentials();
  console.log("modREEF Reef Controller cloud assignment removed");
}

const discoveryManager = new DiscoveryManager([
  new ArpDiscoveryProvider(),
  new MdnsDiscoveryProvider(),
]);

export function createHealthResponse() {
  const health = createEdgeHealthSnapshot();
  const storedCloud = loadCloudCredentials();

  return {
    name: "modREEF Edge",
    version: controllerSoftwareVersion,
    status: health.status,
    checks: health.checks,
    hostname: hostname(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    claimed: Boolean(cloudSync || storedCloud),
    setupId: controllerSetupId(),
    ...(process.env.MODREEF_EDGE_ID ?? storedCloud?.edgeId
      ? { edgeId: process.env.MODREEF_EDGE_ID ?? storedCloud?.edgeId }
      : {}),
    ...(process.env.MODREEF_AQUARIUM_ID ?? storedCloud?.aquariumId
      ? { aquariumId: process.env.MODREEF_AQUARIUM_ID ?? storedCloud?.aquariumId }
      : {}),
  };
}

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");

  try {
    if (await handleOnboardingRequest(
      request,
      response,
      cloudSync ? undefined : claimCloud,
      authorizeCloudClient,
      cloudSync || loadCloudCredentials() ? unclaimCloud : undefined,
    )) {
      return;
    }

    if (await handleAutomationRequest(request, response)) {
      return;
    }

    if (await handleTimelineRequest(request, response)) {
      return;
    }

    if (await handleAquariumRequest(request, response)) {
      return;
    }

    if (await handleEquipmentRequest(request, response)) {
      return;
    }

    if (await handleManagedDeviceRequest(request, response)) {
      return;
    }
  } catch (error) {
    response.writeHead(500);
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200);
    response.end(JSON.stringify(createHealthResponse()));
    return;
  }

  if (request.method === "GET" && request.url === "/devices") {
    try {
      const result = await discoveryManager.scan();

      response.writeHead(200);
      response.end(
        JSON.stringify({
          devices: await Promise.all(
            result.devices.map(inspectDevice),
          ),
          providerErrors: result.providerErrors,
        }),
      );
    } catch (error) {
      response.writeHead(500);
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return;
  }

  if (request.method === "POST" && request.url === "/scan") {
    try {
      const result = await discoveryManager.scan();

      response.writeHead(200);
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(500);
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }

    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({ error: "Not found" }));
});

if (process.env.NODE_ENV !== "test") {
  void initializeAutomation().catch((error) => {
    console.error("Unable to resume automation:", error);
  });

  server.listen(port, "::", () => {
    console.log(`modREEF Edge listening on port ${port}`);
    cloudSync?.start();
    if (cloudSync) console.log("modREEF Edge cloud synchronization enabled");
  });
}
