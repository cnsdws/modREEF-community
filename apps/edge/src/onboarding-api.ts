import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { EdgeCredentialStore } from "./edge-credential-store.js";
import {
  discoverMdpPumps,
  TcpMdpTransport,
  transmitMdpAirLink,
} from "@modreef/driver-jebao-mdp";
import {
  discoverJebaoMd44Dosers,
  TcpJebaoMd44Transport,
} from "@modreef/driver-jebao-md44";
import { LocalAuthorizationStore } from "./local-authorization-store.js";
import { GHomeDiscovery, isPrivateIPv4 } from "./ghome-discovery.js";
import {
  registerGHomeWp12Device,
  registerYinmikWaterDevice,
  registerMdpPump,
  registerMd44Doser,
  registerDmpWavemaker,
  registerMatterDevice,
  getTwin,
  runtimeStore,
} from "./equipment-runtime.js";
import {
  discoverDmpBleCandidates,
  verifyDmpBleIdentity,
} from "./dmp-ble.js";
import {
  OnboardingRegistry,
  type EquipmentRegistration,
} from "./onboarding-registry.js";
import {
  isOperationalHandoffFailure,
  isRecoverableMatterPairingFailure,
  type MatterCommissioningStage,
} from "./matter-controller.js";
import type { EdgeCloudConfig } from "./cloud-sync.js";
import { deviceCredentialPath, repositoryRoot } from "./equipment-runtime-paths.js";
import { getMdpAirLinkNetwork } from "./mdp-airlink-network.js";
import { ghomeRuntimeDeviceId } from "./ghome-runtime-identity.js";

const pairing = new LocalAuthorizationStore(
  Date.now,
  undefined,
  runtimeStore,
);
const registry = new OnboardingRegistry(runtimeStore);
const credentialStore = new EdgeCredentialStore(deviceCredentialPath);
const ghomeDiscovery = new GHomeDiscovery(repositoryRoot);
const md44ProductKey = "1aa33c38ba9d4b78a9e7796705b2fad7";

type MatterJobStatus = "queued" | "running" | "completed" | "failed";
interface MatterCommissioningJob {
  id: string;
  status: MatterJobStatus;
  stage: MatterCommissioningStage | "queued" | "completed" | "failed";
  message: string;
  device?: { id: string; name: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const matterJobs = new Map<string, MatterCommissioningJob>();

type MdpProvisioningStatus = "queued" | "running" | "completed" | "failed";
type MdpProvisioningStage = "queued" | "preparing" | "transmitting" |
  "discovering" | "authenticating" | "completed" | "failed";
interface MdpProvisioningJob {
  id: string;
  status: MdpProvisioningStatus;
  stage: MdpProvisioningStage;
  message: string;
  device?: { id: string; name: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}
interface MdpProvisioningInput {
  ssid: string;
  password: string;
  displayName: string;
  model: "MDP-8500" | "MDP-20000";
}
const mdpProvisioningJobs = new Map<string, MdpProvisioningJob>();

type GizwitsProvisioningStatus = "queued" | "running" | "completed" | "failed";
interface GizwitsProvisioningJob {
  id: string;
  status: GizwitsProvisioningStatus;
  message: string;
  device?: {
    deviceId: string;
    gizwitsDeviceId: string;
    networkAddress: string;
    macAddress: string;
    moduleId: string;
    productKey?: string;
    firmwareVersion?: string;
    equipmentType: "jebao-md44" | "jebao-mdp" | "unknown-gizwits";
    localControlReady: boolean;
    headCount?: number;
    statusFrameLength?: number;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
}
const gizwitsProvisioningJobs = new Map<string, GizwitsProvisioningJob>();

function parseGizwitsProvisioning(body: unknown): { ssid: string; password: string } | null {
  const item = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};
  const ssid = typeof item.ssid === "string" ? item.ssid.trim() : "";
  if (
    Object.keys(item).some((key) => !["ssid", "password"].includes(key)) ||
    Buffer.byteLength(ssid, "utf8") < 1 || Buffer.byteLength(ssid, "utf8") > 32 ||
    typeof item.password !== "string" || Buffer.byteLength(item.password, "utf8") < 8 ||
    Buffer.byteLength(item.password, "utf8") > 63
  ) return null;
  return { ssid, password: item.password };
}

async function runGizwitsProvisioningJob(
  job: GizwitsProvisioningJob,
  input: { ssid: string; password: string },
): Promise<void> {
  const abort = new AbortController();
  const update = (values: Partial<GizwitsProvisioningJob>) => Object.assign(
    job,
    values,
    { updatedAt: new Date().toISOString() },
  );
  try {
    update({ status: "running", message: "Preparing secure Wi-Fi equipment setup…" });
    const network = await getMdpAirLinkNetwork(input.ssid);
    const baseline = new Set((await discoverJebaoMd44Dosers(1_500, {
      localAddress: network.localAddress,
    })).map(({ deviceId }) => deviceId));
    update({ message: "Sending Wi-Fi settings to equipment in setup mode…" });
    let transmissionError: Error | undefined;
    const transmission = transmitMdpAirLink({
      ssid: input.ssid,
      password: input.password,
      bssid: network.bssid,
      localAddress: network.localAddress,
    }, { signal: abort.signal, timeoutMs: 120_000 }).catch((error) => {
      if (!abort.signal.aborted) {
        transmissionError = error instanceof Error ? error : new Error(String(error));
      }
    });
    const deadline = Date.now() + 120_000;
    let candidate: Awaited<ReturnType<typeof discoverJebaoMd44Dosers>>[number] | undefined;
    while (!candidate && Date.now() < deadline) {
      if (transmissionError) throw transmissionError;
      update({ message: "Waiting for Wi-Fi equipment to join the network…" });
      const devices = await discoverJebaoMd44Dosers(3_000, {
        localAddress: network.localAddress,
      });
      candidate = devices.find(({ deviceId }) => !baseline.has(deviceId));
    }
    abort.abort();
    await transmission;
    if (transmissionError) throw transmissionError;
    if (!candidate) throw new Error("No equipment joined Wi-Fi during setup");

    let equipmentType: NonNullable<GizwitsProvisioningJob["device"]>["equipmentType"] =
      "unknown-gizwits";
    let localControlReady = false;
    let headCount: number | undefined;
    let statusFrameLength: number | undefined;
    if (candidate.productKey === md44ProductKey) {
      equipmentType = "jebao-md44";
      headCount = 4;
      const transport = new TcpJebaoMd44Transport(candidate.networkAddress);
      try {
        const status = await transport.readRawStatus();
        localControlReady = true;
        statusFrameLength = status.frame.length;
      } finally {
        await transport.disconnect();
      }
    } else if (candidate.deviceId.startsWith("md44-") && candidate.moduleId.startsWith("0402")) {
      equipmentType = "jebao-mdp";
      const transport = new TcpMdpTransport(candidate.networkAddress);
      try {
        await transport.readState();
        localControlReady = true;
      } finally {
        await transport.disconnect();
      }
    }
    update({
      status: "completed",
      message: "Equipment joined Wi-Fi and was identified.",
      device: {
        ...candidate,
        equipmentType,
        localControlReady,
        ...(headCount === undefined ? {} : { headCount }),
        ...(statusFrameLength === undefined ? {} : { statusFrameLength }),
      },
    });
  } catch (error) {
    abort.abort();
    update({
      status: "failed",
      message: "Wi-Fi equipment setup failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function updateMdpProvisioningJob(
  job: MdpProvisioningJob,
  updates: Partial<MdpProvisioningJob>,
): void {
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
}

function parseMdpProvisioning(body: unknown): MdpProvisioningInput | null {
  const item = typeof body === "object" && body !== null
    ? body as Record<string, unknown>
    : {};
  const ssid = typeof item.ssid === "string" ? item.ssid.trim() : "";
  const displayName = typeof item.displayName === "string" ? item.displayName.trim() : "";
  if (
    Object.keys(item).some((key) => !["ssid", "password", "displayName", "model"].includes(key)) ||
    Buffer.byteLength(ssid, "utf8") < 1 || Buffer.byteLength(ssid, "utf8") > 32 ||
    typeof item.password !== "string" || Buffer.byteLength(item.password, "utf8") < 8 ||
    Buffer.byteLength(item.password, "utf8") > 63 || !displayName || displayName.length > 48 ||
    (item.model !== undefined && item.model !== "MDP-8500" && item.model !== "MDP-20000")
  ) return null;
  return {
    ssid,
    password: item.password,
    displayName,
    model: item.model === "MDP-20000" ? "MDP-20000" : "MDP-8500",
  };
}

async function runMdpProvisioningJob(
  job: MdpProvisioningJob,
  input: MdpProvisioningInput,
): Promise<void> {
  const abort = new AbortController();
  try {
    updateMdpProvisioningJob(job, {
      status: "running", stage: "preparing",
      message: "Checking the Reef Controller's 2.4 GHz Wi-Fi connection…",
    });
    const network = await getMdpAirLinkNetwork(input.ssid);
    const baseline = new Set((await discoverMdpPumps(1_500, {
      localAddress: network.localAddress,
    })).map(({ deviceId }) => deviceId));
    updateMdpProvisioningJob(job, {
      stage: "transmitting",
      message: "Sending Wi-Fi settings to the pump… Keep its Smart Wi-Fi indicator flashing rapidly.",
    });
    let transmissionError: Error | undefined;
    const transmission = transmitMdpAirLink({
      ssid: input.ssid,
      password: input.password,
      bssid: network.bssid,
      localAddress: network.localAddress,
    }, { signal: abort.signal, timeoutMs: 120_000 }).catch((error) => {
      if (!abort.signal.aborted) {
        transmissionError = error instanceof Error ? error : new Error(String(error));
      }
    });
    const discoveryDeadline = Date.now() + 120_000;
    let candidate: Awaited<ReturnType<typeof discoverMdpPumps>>[number] | undefined;
    while (!candidate && Date.now() < discoveryDeadline) {
      if (transmissionError) throw transmissionError;
      updateMdpProvisioningJob(job, {
        stage: "discovering",
        message: "Waiting for the pump to join Wi-Fi… This can take up to two minutes.",
      });
      const found = await discoverMdpPumps(3_000, { localAddress: network.localAddress });
      candidate = found.find(({ deviceId }) => !baseline.has(deviceId));
    }
    abort.abort();
    await transmission;
    if (transmissionError) throw transmissionError;
    if (!candidate) throw new Error("No newly connected MDP pump was found");
    updateMdpProvisioningJob(job, {
      stage: "authenticating",
      message: "Pump joined Wi-Fi. Authenticating local control…",
    });
    const transport = new TcpMdpTransport(candidate.networkAddress);
    try {
      await transport.connect();
      await transport.readState();
    } finally {
      await transport.disconnect();
    }
    const updated = registerMdpPump({
      deviceId: candidate.deviceId,
      networkAddress: candidate.networkAddress,
      displayName: input.displayName,
      model: input.model,
    });
    const device = updated.devices?.find(({ id }) => id === candidate.deviceId);
    if (!device) throw new Error("Pump registered without a device record");
    updateMdpProvisioningJob(job, {
      status: "completed", stage: "completed",
      message: "Pump connected and local control is ready.",
      device: { id: device.id, name: device.name },
    });
  } catch (error) {
    abort.abort();
    updateMdpProvisioningJob(job, {
      status: "failed", stage: "failed",
      message: error instanceof Error ? error.message : "MDP pump setup failed",
      error: "mdp-provisioning-failed",
    });
    console.error("MDP AirLink provisioning failed:", error instanceof Error ? error.message : String(error));
  }
}

function updateMatterJob(
  job: MatterCommissioningJob,
  updates: Partial<MatterCommissioningJob>,
): void {
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
}

const stageMessages: Record<MatterCommissioningStage, string> = {
  preparing: "Preparing a fresh secure pairing session…",
  commissioning: "Establishing a secure connection and joining the device to Wi-Fi…",
  recovering: "The connection was interrupted. Retrying once with a fresh session…",
  verifying: "Verifying outlets and local control…",
};

async function runMatterJob(
  job: MatterCommissioningJob,
  commissioning: NonNullable<ReturnType<typeof parseMatterCommissioning>>,
): Promise<void> {
  updateMatterJob(job, {
    status: "running",
    stage: "preparing",
    message: stageMessages.preparing,
  });
  try {
    const updated = await registerMatterDevice(
      commissioning.pairingCode,
      commissioning.displayName,
      commissioning.wifiNetwork,
      commissioning.compatibilityHint,
      (stage) => updateMatterJob(job, {
        status: "running",
        stage,
        message: stageMessages[stage],
      }),
    );
    const device = updated.devices?.at(-1);
    if (!device) throw new Error("Commissioning completed without a registered device");
    updateMatterJob(job, {
      status: "completed",
      stage: "completed",
      message: "Device connected. Outlets are ready for configuration.",
      device: { id: device.id, name: device.name },
    });
  } catch (error) {
    const handoffFailure = isOperationalHandoffFailure(error);
    const transientPairingFailure = isRecoverableMatterPairingFailure(error);
    const message = handoffFailure
      ? "The device joined Wi-Fi, but the Edge could not reconnect to it. Factory-reset the device and try again."
      : transientPairingFailure
        ? "The Edge found the device but could not maintain the secure connection. Keep it in pairing mode and try again."
      : error instanceof Error ? error.message : "Matter commissioning failed";
    updateMatterJob(job, {
      status: "failed",
      stage: "failed",
      message,
      error: handoffFailure
        ? "operational-handoff-failed"
        : transientPairingFailure
          ? "secure-connection-failed"
          : "commissioning-failed",
    });
    console.error("Matter commissioning failed:", error);
  }
}

const registrationKeys = new Set([
  "deviceId",
  "displayName",
  "transport",
  "manufacturer",
  "model",
  "networkAddress",
  "commissioningId",
]);

function isOptionalString(
  value: unknown,
): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parseRegistration(
  body: unknown,
): EquipmentRegistration | null {
  if (
    typeof body !== "object" ||
    body === null ||
    Object.keys(body).some(
      (key) => !registrationKeys.has(key),
    ) ||
    !("deviceId" in body) ||
    typeof body.deviceId !== "string" ||
    body.deviceId.trim() === "" ||
    !("displayName" in body) ||
    typeof body.displayName !== "string" ||
    body.displayName.trim() === "" ||
    !("transport" in body) ||
    body.transport !== "bluetooth-le" ||
    !isOptionalString(
      "manufacturer" in body ? body.manufacturer : undefined,
    ) ||
    !isOptionalString(
      "model" in body ? body.model : undefined,
    ) ||
    !isOptionalString(
      "networkAddress" in body
        ? body.networkAddress
        : undefined,
    ) ||
    !isOptionalString(
      "commissioningId" in body
        ? body.commissioningId
        : undefined,
    )
  ) {
    return null;
  }

  return {
    deviceId: body.deviceId.trim(),
    displayName: body.displayName.trim(),
    transport: "bluetooth-le",
    ...("manufacturer" in body &&
    typeof body.manufacturer === "string"
      ? { manufacturer: body.manufacturer.trim() }
      : {}),
    ...("model" in body && typeof body.model === "string"
      ? { model: body.model.trim() }
      : {}),
    ...("networkAddress" in body &&
    typeof body.networkAddress === "string"
      ? { networkAddress: body.networkAddress.trim() }
      : {}),
    ...("commissioningId" in body &&
    typeof body.commissioningId === "string"
      ? { commissioningId: body.commissioningId.trim() }
      : {}),
  };
}

interface GHomeCredentialHandoff {
  deviceId: string;
  localKey: string;
  networkAddress?: string;
  displayName?: string;
  productId?: string;
  initialDps?: Record<string, unknown>;
}

function parseMatterCommissioning(body: unknown): {
  pairingCode: string;
  displayName?: string;
  wifiNetwork?: { ssid: string; password: string };
  compatibilityHint?: "tapo-p316m";
} | null {
  const candidate = body as Record<string, unknown> | null;
  if (
    !candidate ||
    typeof body !== "object" ||
    Object.keys(candidate).some((key) => !["pairingCode", "displayName", "ssid", "password", "compatibilityHint"].includes(key)) ||
    typeof candidate.pairingCode !== "string" ||
    candidate.pairingCode.length > 1024 ||
    (!/^\d{11}$/.test(candidate.pairingCode.replace(/[\s-]/g, "")) &&
      !candidate.pairingCode.trim().startsWith("MT:")) ||
    (candidate.displayName !== undefined && typeof candidate.displayName !== "string") ||
    (candidate.ssid !== undefined && (typeof candidate.ssid !== "string" || !candidate.ssid.trim())) ||
    (candidate.password !== undefined && typeof candidate.password !== "string") ||
    ((candidate.ssid === undefined) !== (candidate.password === undefined))
    || (candidate.compatibilityHint !== undefined && candidate.compatibilityHint !== "tapo-p316m")
  ) {
    return null;
  }
  return {
    pairingCode: candidate.pairingCode.trim().startsWith("MT:")
      ? candidate.pairingCode.trim()
      : candidate.pairingCode.replace(/[\s-]/g, ""),
    ...(typeof candidate.displayName === "string" && candidate.displayName.trim()
      ? { displayName: candidate.displayName.trim() }
      : {}),
    ...(typeof candidate.ssid === "string" && typeof candidate.password === "string"
      ? { wifiNetwork: { ssid: candidate.ssid.trim(), password: candidate.password } }
      : {}),
    ...(candidate.compatibilityHint === "tapo-p316m"
      ? { compatibilityHint: candidate.compatibilityHint }
      : {}),
  };
}

function parseGHomeCredentials(
  body: unknown,
): GHomeCredentialHandoff | null {
  if (
    typeof body !== "object" ||
    body === null ||
    Object.keys(body).some(
      (key) => ![
        "deviceId", "localKey", "networkAddress", "displayName", "productId", "initialDps",
      ].includes(key),
    ) ||
    !("deviceId" in body) ||
    typeof body.deviceId !== "string" ||
    !("localKey" in body) ||
    typeof body.localKey !== "string"
  ) {
    return null;
  }

  const displayName = "displayName" in body ? body.displayName : undefined;
  if (displayName !== undefined && (
    typeof displayName !== "string" || !displayName.trim() || displayName.length > 48
  )) return null;
  const networkAddress = "networkAddress" in body ? body.networkAddress : undefined;
  if (networkAddress !== undefined && (
    typeof networkAddress !== "string" || !isPrivateIPv4(networkAddress.trim())
  )) return null;
  const productId = "productId" in body ? body.productId : undefined;
  if (productId !== undefined && (
    typeof productId !== "string" || !productId.trim() || productId.length > 64
  )) return null;
  const initialDps = "initialDps" in body ? body.initialDps : undefined;
  if (initialDps !== undefined && (
    typeof initialDps !== "object" || initialDps === null || Array.isArray(initialDps)
  )) return null;

  const values = [body.deviceId, body.localKey];

  if (
    values.some(
      (value) =>
        value.trim() === "" ||
        value.includes("\n") ||
        value.includes("\r"),
    )
  ) {
    return null;
  }

  return {
    deviceId: body.deviceId.trim(),
    localKey: body.localKey,
    ...(typeof networkAddress === "string"
      ? { networkAddress: networkAddress.trim() }
      : {}),
    ...(typeof displayName === "string" ? { displayName: displayName.trim() } : {}),
    ...(typeof productId === "string" ? { productId: productId.trim() } : {}),
    ...(initialDps === undefined ? {} : { initialDps: initialDps as Record<string, unknown> }),
  };
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

export function isOnboardingAuthorized(
  request: IncomingMessage,
): boolean {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  return pairing.isAuthorized(
    authorization.slice("Bearer ".length),
  );
}

export async function handleOnboardingRequest(
  request: IncomingMessage,
  response: ServerResponse,
  claimCloud?: (credentials: EdgeCloudConfig, claimSecret?: string) => Promise<void>,
  authorizeCloudClient?: (grant: string) => boolean,
  unclaimCloud?: () => Promise<void>,
  controllerInventory: () => {
    deviceIds: string[];
    equipmentIds: string[];
  } = () => {
    const twin = getTwin();
    return {
      deviceIds: (twin.devices ?? []).map(({ id }) => id),
      equipmentIds: twin.equipment.map(({ id }) => id),
    };
  },
): Promise<boolean> {
  if (
    request.method === "POST" &&
    request.url === "/onboarding/cloud-authorization"
  ) {
    const body = await readJson(request);
    const grant = typeof body === "object" && body !== null &&
      "grant" in body && typeof body.grant === "string"
      ? body.grant
      : "";
    if (!grant || !authorizeCloudClient?.(grant)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Cloud authorization was rejected" }));
      return true;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ authorization: pairing.authorizeTrustedClient() }));
    return true;
  }
  if (request.method === "POST" && request.url === "/onboarding/cloud-claim") {
    if (!claimCloud) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: "This Reef Controller is already claimed" }));
      return true;
    }
    const body = await readJson(request);
    if (
      typeof body !== "object" || body === null ||
      !("edgeId" in body) || typeof body.edgeId !== "string" || !body.edgeId ||
      !("aquariumId" in body) || typeof body.aquariumId !== "string" || !body.aquariumId ||
      !("token" in body) || typeof body.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.token)
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid Reef Controller registration" }));
      return true;
    }
    try {
      const claimSecret = "claimSecret" in body && typeof body.claimSecret === "string"
        ? body.claimSecret
        : undefined;
      if (claimSecret !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(claimSecret)) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Invalid Reef Controller setup code" }));
        return true;
      }
      await claimCloud({
        cloudUrl: "https://api.modreef.net",
        edgeId: body.edgeId,
        aquariumId: body.aquariumId,
        token: body.token,
      }, claimSecret);
      const authorization = pairing.authorizeTrustedClient();
      response.writeHead(200);
      response.end(JSON.stringify({
        claimed: true,
        edgeId: body.edgeId,
        authorization,
      }));
    } catch (error) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : "Cloud registration was rejected",
      }));
    }
    return true;
  }
  if (request.method === "POST" && request.url === "/onboarding/cloud-unclaim") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const { deviceIds, equipmentIds } = controllerInventory();
    if (deviceIds.length > 0 || equipmentIds.length > 0) {
      response.writeHead(409);
      response.end(JSON.stringify({
        error: "Remove every device before removing this Reef Controller",
        code: "CONTROLLER_HAS_DEVICES",
        deviceIds,
        equipmentIds,
      }));
      return true;
    }
    if (!unclaimCloud) {
      response.writeHead(409);
      response.end(JSON.stringify({ error: "This Reef Controller is not claimed" }));
      return true;
    }
    await unclaimCloud();
    response.writeHead(200);
    response.end(JSON.stringify({ unclaimed: true }));
    return true;
  }
  if (
    request.method === "GET" &&
    request.url === "/onboarding/authorization"
  ) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ authorized: false }));
      return true;
    }

    response.writeHead(200);
    response.end(JSON.stringify({ authorized: true }));
    return true;
  }

  if (
    request.method === "POST" &&
    request.url === "/onboarding/credentials/ghome-wp12"
  ) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }

    const credentials = parseGHomeCredentials(
      await readJson(request),
    );

    if (!credentials) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error:
            "Body must contain valid deviceId and localKey fields",
        }),
      );
      return true;
    }

    try {
      const networkAddress =
        await ghomeDiscovery.findPrivateAddress(
          credentials.deviceId,
        );

      const storedBeforeHandoff = credentialStore.listGHomeWp12();
      const runtimeDeviceId = ghomeRuntimeDeviceId(
        credentials.deviceId,
        storedBeforeHandoff,
      );
      const useLegacyIdentity = runtimeDeviceId === "ghome-wp12";
      const storedCredentials = {
        deviceId: credentials.deviceId,
        localKey: credentials.localKey,
        networkAddress,
        runtimeDeviceId,
        deviceKind: "ghome-wp12" as const,
      };
      credentialStore.saveGHomeWp12(storedCredentials);
      registerGHomeWp12Device(
        storedCredentials,
        useLegacyIdentity,
        credentials.displayName,
      );

      response.writeHead(201);
      response.end(JSON.stringify({ stored: true }));
    } catch (error) {
      console.error(
        "GHome LAN discovery failed:",
        error instanceof Error ? error.message : String(error),
      );
      response.writeHead(502);
      response.end(
        JSON.stringify({
          error: "Could not discover the device on the local network",
        }),
      );
    }

    return true;
  }

  if (
    request.method === "POST" &&
    request.url === "/onboarding/credentials/yinmik-water"
  ) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const credentials = parseGHomeCredentials(await readJson(request));
    if (!credentials?.productId) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid water-meter credential handoff" }));
      return true;
    }
    try {
      const networkAddress = credentials.networkAddress ??
        await ghomeDiscovery.findPrivateAddress(credentials.deviceId);
      const storedCredentials = {
        deviceId: credentials.deviceId,
        localKey: credentials.localKey,
        networkAddress,
        productId: credentials.productId,
        deviceKind: "yinmik-water" as const,
      };
      credentialStore.saveGHomeWp12(storedCredentials);
      if (credentials.initialDps) {
        runtimeStore.saveState(
          `yinmik-water-initial-dps:${credentials.deviceId}`,
          credentials.initialDps,
        );
      }
      registerYinmikWaterDevice(storedCredentials, credentials.displayName);
      response.writeHead(201);
      response.end(JSON.stringify({ stored: true, networkAddress }));
    } catch (error) {
      console.error(
        "YINMIK LAN discovery failed:",
        error instanceof Error ? error.message : String(error),
      );
      response.writeHead(502);
      response.end(JSON.stringify({ error: "Could not discover the water meter" }));
    }
    return true;
  }

  if (request.method === "GET" && request.url === "/onboarding/mdp") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    try {
      const devices = await discoverMdpPumps();
      response.writeHead(200);
      response.end(JSON.stringify({ devices }));
    } catch (error) {
      response.writeHead(502);
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : "Pump discovery failed",
      }));
    }
    return true;
  }

  if (request.method === "GET" && request.url === "/onboarding/md44") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    try {
      const discovered = (await discoverJebaoMd44Dosers(5_000))
        .filter(({ productKey }) => productKey === md44ProductKey);
      const devices = await Promise.all(discovered.map(async (device) => {
        const transport = new TcpJebaoMd44Transport(device.networkAddress);
        try {
          const status = await transport.readRawStatus();
          return {
            ...device,
            headCount: 4,
            localControlReady: true,
            statusFrameLength: status.frame.length,
          };
        } catch (error) {
          return {
            ...device,
            headCount: 4,
            localControlReady: false,
            statusError: error instanceof Error ? error.message : String(error),
          };
        } finally {
          await transport.disconnect();
        }
      }));
      response.writeHead(200);
      response.end(JSON.stringify({ devices }));
    } catch (error) {
      response.writeHead(502);
      response.end(JSON.stringify({
        error: error instanceof Error ? error.message : "Doser discovery failed",
      }));
    }
    return true;
  }

  if (request.method === "POST" && request.url === "/onboarding/md44") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const body = await readJson(request);
    const item = typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : {};
    if (
      typeof item.deviceId !== "string" ||
      !/^md44-[0-9a-f]{12}$/i.test(item.deviceId) ||
      typeof item.networkAddress !== "string" || isIP(item.networkAddress) !== 4 ||
      typeof item.gizwitsDeviceId !== "string" || !item.gizwitsDeviceId ||
      typeof item.displayName !== "string" || !item.displayName.trim()
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid MD-4.4 registration" }));
      return true;
    }
    const registration = {
      deviceId: item.deviceId.toLowerCase(),
      networkAddress: item.networkAddress,
      gizwitsDeviceId: item.gizwitsDeviceId,
      displayName: item.displayName.trim().slice(0, 48),
    };
    const updated = registerMd44Doser(registration);
    response.writeHead(201);
    response.end(JSON.stringify({
      device: updated.devices?.find(({ id }) => id === registration.deviceId),
      equipment: updated.equipment.filter(
        ({ physicalDeviceId }) => physicalDeviceId === registration.deviceId,
      ),
    }));
    return true;
  }

  const gizwitsProvisioningMatch =
    /^\/onboarding\/gizwits\/provision\/([^/]+)$/.exec(request.url ?? "");
  if (request.method === "GET" && gizwitsProvisioningMatch?.[1]) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const job = gizwitsProvisioningJobs.get(
      decodeURIComponent(gizwitsProvisioningMatch[1]),
    );
    if (!job) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Equipment setup job not found" }));
      return true;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ job }));
    return true;
  }

  if (request.method === "POST" && request.url === "/onboarding/gizwits/provision") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const input = parseGizwitsProvisioning(await readJson(request));
    if (!input) {
      response.writeHead(400);
      response.end(JSON.stringify({
        error: "A 2.4 GHz Wi-Fi name and 8–63 character password are required",
      }));
      return true;
    }
    const now = new Date().toISOString();
    const job: GizwitsProvisioningJob = {
      id: randomUUID(),
      status: "queued",
      message: "Wi-Fi equipment setup queued…",
      createdAt: now,
      updatedAt: now,
    };
    gizwitsProvisioningJobs.set(job.id, job);
    void runGizwitsProvisioningJob(job, input);
    response.writeHead(202);
    response.end(JSON.stringify({ job }));
    return true;
  }

  if (request.method === "POST" && request.url === "/onboarding/mdp") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const body = await readJson(request);
    const item = typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : {};
    if (
      typeof item.deviceId !== "string" ||
      !/^mdp-[0-9a-f]{12}$/i.test(item.deviceId) ||
      typeof item.networkAddress !== "string" ||
      isIP(item.networkAddress) !== 4 ||
      typeof item.displayName !== "string" ||
      !item.displayName.trim() ||
      item.displayName.trim().length > 48 ||
      (item.model !== undefined &&
        item.model !== "MDP-8500" && item.model !== "MDP-20000")
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid MDP pump registration" }));
      return true;
    }
    const registration = {
      deviceId: item.deviceId.toLowerCase(),
      networkAddress: item.networkAddress,
      displayName: item.displayName.trim(),
      model: item.model === "MDP-20000" ? "MDP-20000" as const : "MDP-8500" as const,
    };
    const transport = new TcpMdpTransport(registration.networkAddress);
    try {
      await transport.connect();
      await transport.readState();
      await transport.disconnect();
      const updated = registerMdpPump(registration);
      response.writeHead(201);
      response.end(JSON.stringify({
        device: updated.devices?.find(({ id }) => id === registration.deviceId),
      }));
    } catch (error) {
      await transport.disconnect();
      response.writeHead(502);
      response.end(JSON.stringify({
        error: error instanceof Error
          ? `Pump authentication failed: ${error.message}`
          : "Pump authentication failed",
      }));
    }
    return true;
  }

  if (request.method === "GET" && request.url === "/onboarding/dmp/discover") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const devices = await discoverDmpBleCandidates();
    response.writeHead(200);
    response.end(JSON.stringify({ devices }));
    return true;
  }

  if (request.method === "POST" && request.url === "/onboarding/dmp") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const body = await readJson(request);
    const item = typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : {};
    if (
      typeof item.deviceId !== "string" ||
      !/^dmp-[0-9a-f]{4,12}$/i.test(item.deviceId) ||
      typeof item.displayName !== "string" ||
      !item.displayName.trim() ||
      typeof item.advertisedName !== "string" ||
      !/^(?:XPG-GAgent-[0-9a-f]{4}|W_[0-9a-f]{6})$/i.test(item.advertisedName) ||
      typeof item.bluetoothAddress !== "string" ||
      !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(item.bluetoothAddress)
    ) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Invalid DMP wavemaker registration" }));
      return true;
    }
    const identity = {
      advertisedName: item.advertisedName,
      bluetoothAddress: item.bluetoothAddress.toUpperCase(),
    };
    await verifyDmpBleIdentity(identity);
    const deviceId = item.deviceId.toLowerCase();
    const updated = registerDmpWavemaker({
      deviceId,
      displayName: item.displayName.trim(),
      advertisedName: identity.advertisedName,
      bluetoothAddress: identity.bluetoothAddress,
    });
    response.writeHead(201);
    response.end(JSON.stringify({
      device: updated.devices?.find(({ id }) => id === deviceId),
    }));
    return true;
  }

  const mdpProvisioningJobMatch = /^\/onboarding\/mdp\/provision\/([^/]+)$/.exec(
    request.url ?? "",
  );
  if (request.method === "GET" && mdpProvisioningJobMatch?.[1]) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const job = mdpProvisioningJobs.get(decodeURIComponent(mdpProvisioningJobMatch[1]));
    if (!job) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Pump setup job not found" }));
      return true;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ job }));
    return true;
  }

  if (request.method === "POST" && request.url === "/onboarding/mdp/provision") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const input = parseMdpProvisioning(await readJson(request));
    if (!input) {
      response.writeHead(400);
      response.end(JSON.stringify({
        error: "Enter a pump name, 2.4 GHz Wi-Fi name, and an 8–63 character Wi-Fi password",
      }));
      return true;
    }
    const now = new Date().toISOString();
    const job: MdpProvisioningJob = {
      id: randomUUID(), status: "queued", stage: "queued",
      message: "Waiting to start MDP pump setup…", createdAt: now, updatedAt: now,
    };
    mdpProvisioningJobs.set(job.id, job);
    const cleanupTimer = setTimeout(() => mdpProvisioningJobs.delete(job.id), 60 * 60 * 1000);
    cleanupTimer.unref();
    void runMdpProvisioningJob(job, input);
    response.writeHead(202);
    response.end(JSON.stringify({ job }));
    return true;
  }

  const matterJobMatch = /^\/onboarding\/matter\/([^/]+)$/.exec(
    request.url ?? "",
  );
  if (request.method === "GET" && matterJobMatch?.[1]) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }
    const job = matterJobs.get(decodeURIComponent(matterJobMatch[1]));
    if (!job) {
      response.writeHead(404);
      response.end(JSON.stringify({ error: "Pairing job not found" }));
      return true;
    }
    response.writeHead(200);
    response.end(JSON.stringify({ job }));
    return true;
  }

  if (request.method === "POST" && request.url === "/onboarding/matter") {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }

    const commissioning = parseMatterCommissioning(await readJson(request));
    if (!commissioning) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: "Enter the 11-digit Matter setup code" }));
      return true;
    }

    const now = new Date().toISOString();
    const job: MatterCommissioningJob = {
      id: randomUUID(),
      status: "queued",
      stage: "queued",
      message: "Waiting to start secure device pairing…",
      createdAt: now,
      updatedAt: now,
    };
    matterJobs.set(job.id, job);
    const cleanupTimer = setTimeout(
      () => matterJobs.delete(job.id),
      60 * 60 * 1000,
    );
    cleanupTimer.unref();
    void runMatterJob(job, commissioning);

    response.writeHead(202);
    response.end(JSON.stringify({ job }));
    return true;
  }

  if (
    request.method === "GET" &&
    request.url === "/onboarding/equipment"
  ) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }

    response.writeHead(200);
    response.end(
      JSON.stringify({ equipment: registry.list() }),
    );
    return true;
  }

  if (
    request.method === "POST" &&
    request.url === "/onboarding/equipment"
  ) {
    if (!isOnboardingAuthorized(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return true;
    }

    const registration = parseRegistration(
      await readJson(request),
    );

    if (!registration) {
      response.writeHead(400);
      response.end(
        JSON.stringify({
          error:
            "Body contains invalid or prohibited registration fields",
        }),
      );
      return true;
    }

    response.writeHead(201);
    response.end(
      JSON.stringify({
        equipment: registry.register(registration),
      }),
    );
    return true;
  }

  return false;
}
