import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { CloudApplication } from "./application.js";
import { OidcAuthenticator } from "./auth.js";
import { PostgresCloudRepository } from "./postgres-repository.js";
import { OpenAIReefCoachProvider } from "./reef-coach-provider.js";
import { ResendInvitationNotifier } from "./invitation-notifier.js";
import {
  PostgresEdgeReleaseStore,
  validPublishToken,
  validReleaseMetadata,
  validReleaseSignature,
} from "./edge-release-store.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const pool = new Pool({ connectionString: required("MODREEF_DATABASE_URL") });
const edgeReleaseStore = new PostgresEdgeReleaseStore(pool);
const repository = new PostgresCloudRepository(pool);
const notificationSender = process.env.RESEND_API_KEY && process.env.MODREEF_INVITATION_FROM_EMAIL
  ? new ResendInvitationNotifier(
    process.env.RESEND_API_KEY,
    process.env.MODREEF_INVITATION_FROM_EMAIL,
    process.env.MODREEF_PUBLIC_APP_URL ?? "https://www.modreef.net",
  )
  : undefined;
const app = new CloudApplication(
  repository,
  new OidcAuthenticator({
    issuer: required("MODREEF_OIDC_ISSUER"),
    audience: required("MODREEF_OIDC_AUDIENCE"),
    ...(process.env.MODREEF_OIDC_JWKS_URL ? { jwksUrl: process.env.MODREEF_OIDC_JWKS_URL } : {}),
  }),
  process.env.OPENAI_API_KEY
    ? new OpenAIReefCoachProvider(
      process.env.OPENAI_API_KEY,
      process.env.MODREEF_REEF_COACH_MODEL ?? "gpt-5.6-sol",
    )
    : undefined,
  notificationSender,
);

const allowedOrigins = new Set(
  (process.env.MODREEF_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const maximumBodyBytes = 1_048_576;
const maximumReleaseBytes = 67_108_864;
const wordmark = await readFile(
  new URL(
    "../../mobile/assets/brand/modreef-wordmark-transparent.png",
    import.meta.url,
  ),
);
const symbol = await readFile(
  new URL(
    "../../mobile/assets/brand/modreef-symbol-transparent.png",
    import.meta.url,
  ),
);
const canonicalLogo = await readFile(
  new URL(
    "../../mobile/assets/brand/modreef-logo.png",
    import.meta.url,
  ),
);
const edgeRelease = await readFile(
  new URL("../edge-release.tar.gz", import.meta.url),
).catch(() => null);
const edgeReleaseSha256 = await readFile(
  new URL("../edge-release.sha256", import.meta.url), "utf8",
).then((value) => value.trim()).catch(() => null);
const edgeReleaseSignature = await readFile(
  new URL("../edge-release.signature", import.meta.url), "utf8",
).then((value) => value.trim()).catch(() => null);
const publicApiUrl = (process.env.MODREEF_PUBLIC_API_URL ?? "https://api.modreef.net").replace(/\/$/, "");

async function readRequestBody(
  request: AsyncIterable<unknown>,
  maximumBytes: number,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new Error("Unsupported request body chunk");
    }
    const buffer = Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maximumBytes) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const requestPath = new URL(
    request.url ?? "/",
    "http://localhost",
  ).pathname;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    requestPath === "/v1/releases/edge/latest"
  ) {
    const stored = await edgeReleaseStore.getRelease("production").catch(() => null);
    const archive = stored?.archive ?? edgeRelease;
    const sha256 = stored?.sha256 ?? edgeReleaseSha256;
    if (!archive || !sha256) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Edge release is unavailable" }));
      return;
    }
    const body = JSON.stringify({
      channel: "production",
      sha256,
      size: archive.length,
      signature: stored?.signature ?? edgeReleaseSignature,
      sourceCommit: stored?.sourceCommit,
      publishedAt: stored?.publishedAt,
      url: `${publicApiUrl}/v1/releases/edge/archive`,
    });
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    requestPath === "/v1/releases/edge/staging/latest"
  ) {
    const release = await edgeReleaseStore.getRelease("staging").catch((error) => {
      console.error("Could not load staging Edge release:", error);
      return undefined;
    });
    if (release === undefined) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Staging release service is unavailable" }));
      return;
    }
    if (!release) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "No staging Edge release has been published" }));
      return;
    }
    const body = JSON.stringify({
      channel: release.channel,
      sha256: release.sha256,
      size: release.size,
      sourceCommit: release.sourceCommit,
      publishedAt: release.publishedAt,
      signature: release.signature,
      url: `${publicApiUrl}/v1/releases/edge/staging/archive`,
    });
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      "content-type": "application/json",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    requestPath === "/v1/releases/edge/staging/archive"
  ) {
    const release = await edgeReleaseStore.getRelease("staging").catch((error) => {
      console.error("Could not load staging Edge archive:", error);
      return undefined;
    });
    if (release === undefined) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Staging release service is unavailable" }));
      return;
    }
    if (!release) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "No staging Edge release has been published" }));
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-disposition": "attachment; filename=modreef-edge-staging.tar.gz",
      "content-length": release.archive.length,
      "content-type": "application/gzip",
      "x-modreef-release-sha256": release.sha256,
    });
    response.end(request.method === "HEAD" ? undefined : release.archive);
    return;
  }
  if (request.method === "PUT" && requestPath === "/v1/releases/edge/staging") {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!process.env.MODREEF_RELEASE_PUBLISH_TOKEN) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Staging release publication is not configured" }));
      return;
    }
    if (!validPublishToken(token, process.env.MODREEF_RELEASE_PUBLISH_TOKEN)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid release publication token" }));
      return;
    }
    const sha256 = request.headers["x-modreef-release-sha256"];
    const sourceCommit = request.headers["x-modreef-source-commit"];
    const signature = request.headers["x-modreef-release-signature"];
    const shaValue = Array.isArray(sha256) ? sha256[0] : sha256;
    const commitValue = Array.isArray(sourceCommit) ? sourceCommit[0] : sourceCommit;
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;
    if (!validReleaseMetadata(shaValue, commitValue) || !validReleaseSignature(signatureValue)) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid release metadata" }));
      return;
    }
    const archive = await readRequestBody(request, maximumReleaseBytes);
    if (!archive) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Release archive is too large" }));
      return;
    }
    try {
      const release = await edgeReleaseStore.publishStagingRelease({
        sha256: shaValue,
        sourceCommit: commitValue!,
        archive,
        signature: signatureValue!,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        channel: release.channel,
        sha256: release.sha256,
        size: release.size,
        sourceCommit: release.sourceCommit,
        publishedAt: release.publishedAt,
        signature: release.signature,
      }));
    } catch (error) {
      const invalidArchive = error instanceof Error &&
        error.message === "Release checksum does not match archive";
      if (!invalidArchive) console.error("Could not publish staging Edge release:", error);
      response.writeHead(invalidArchive ? 400 : 500, { "content-type": "application/json" });
      response.end(JSON.stringify({
        error: invalidArchive ? error.message : "Could not publish staging Edge release",
      }));
    }
    return;
  }
  if (request.method === "POST" && requestPath === "/v1/releases/edge/promote") {
    const token = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined;
    const sourceCommit = request.headers["x-modreef-source-commit"];
    const commitValue = Array.isArray(sourceCommit) ? sourceCommit[0] : sourceCommit;
    if (!validPublishToken(token, process.env.MODREEF_RELEASE_PUBLISH_TOKEN)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid release publication token" }));
      return;
    }
    if (!commitValue || !/^[a-f0-9]{40}$/.test(commitValue)) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid source commit" }));
      return;
    }
    const release = await edgeReleaseStore.promoteStagingRelease(commitValue).catch((error) => {
      console.error("Could not promote Edge release:", error);
      return undefined;
    });
    if (release === undefined) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Could not promote Edge release" }));
      return;
    }
    if (!release) {
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "The signed staging release does not match this commit" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      channel: release.channel, sha256: release.sha256, size: release.size,
      sourceCommit: release.sourceCommit, publishedAt: release.publishedAt,
      signature: release.signature,
    }));
    return;
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    requestPath === "/v1/releases/edge/archive"
  ) {
    const stored = await edgeReleaseStore.getRelease("production").catch(() => null);
    const archive = stored?.archive ?? edgeRelease;
    if (!archive) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Edge release is unavailable" }));
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-disposition": "attachment; filename=modreef-edge-release.tar.gz",
      "content-length": archive.length,
      "content-type": "application/gzip",
    });
    response.end(request.method === "HEAD" ? undefined : archive);
    return;
  }
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (requestPath === "/assets/modreef-wordmark.png" ||
      requestPath === "/assets/modreef-symbol.png" ||
      requestPath === "/assets/modreef-auth0-logo.png" ||
      requestPath === "/assets/modreef-logo.png")
  ) {
    const asset = requestPath.endsWith("symbol.png")
      ? symbol
      : requestPath.endsWith("auth0-logo.png") ||
          requestPath.endsWith("modreef-logo.png")
        ? canonicalLogo
        : wordmark;
    response.writeHead(200, {
      "cache-control": "public, max-age=3600",
      "content-length": asset.length,
      "content-type": "image/png",
    });
    response.end(request.method === "HEAD" ? undefined : asset);
    return;
  }

  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins.has(origin)) {
      response.writeHead(403).end();
      return;
    }
    response.writeHead(204, {
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,cache-control",
      "access-control-max-age": "600",
    }).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > maximumBodyBytes) {
        response.writeHead(413, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      chunks.push(buffer);
    }
    let body: unknown;
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Invalid JSON", code: "INVALID_JSON" }));
        return;
      }
    }
    const result = await app.handle({
      method: request.method ?? "GET",
      path: requestPath,
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
      ...(body !== undefined ? { body } : {}),
    });
    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  } catch (error) {
    console.error("Cloud request failed:", error);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Internal server error", code: "INTERNAL_ERROR" }));
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => console.log(`modREEF Cloud API listening on port ${port}`));

let notificationWorkerRunning = false;
async function deliverPendingNotifications(): Promise<void> {
  if (!notificationSender?.sendAlert || notificationWorkerRunning) return;
  notificationWorkerRunning = true;
  try {
    const pending = await repository.claimPendingEmailNotifications();
    for (const delivery of pending) {
      try {
        await notificationSender.sendAlert({
          aquariumName: delivery.aquariumName,
          email: delivery.recipient,
          title: delivery.title,
          details: delivery.details,
        });
        await repository.completeEmailNotification(delivery.id);
      } catch (error) {
        await repository.completeEmailNotification(
          delivery.id,
          error instanceof Error ? error.message : "Notification delivery failed",
        );
      }
    }
  } catch (error) {
    console.error("Notification worker failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    notificationWorkerRunning = false;
  }
}
const notificationTimer = setInterval(() => void deliverPendingNotifications(), 15_000);
notificationTimer.unref();
void deliverPendingNotifications();

const shutdown = () => {
  console.log("modREEF Cloud API shutting down");
  server.close(() => void pool.end());
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
