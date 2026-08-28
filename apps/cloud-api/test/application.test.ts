import { describe, expect, it } from "vitest";
import type {
  AquariumEvent, AquariumSummary, CloudCommand, CloudCommandRequest,
  CloudDeviceSnapshot, CloudEquipmentSnapshot, EdgeSummary,
} from "@modreef/api-contract";
import { defaultWaterAlarmRules } from "@modreef/api-contract";
import { CloudApplication } from "../src/application.js";
import type { Authenticator, CloudRepository, Identity } from "../src/types.js";

const aquariums: AquariumSummary[] = [
  { id: "reef-a", name: "Alice Reef", role: "owner", createdAt: "2026-01-01T00:00:00Z" },
  { id: "reef-b", name: "Bob Reef", role: "owner", createdAt: "2026-01-01T00:00:00Z" },
];
const memberships: Record<string, string[]> = { alice: ["reef-a"], bob: ["reef-b"], charlie: ["reef-a"] };
const roles: Record<string, "owner" | "admin" | "viewer"> = { alice: "owner", bob: "owner", charlie: "viewer" };

class FixtureAuth implements Authenticator {
  async authenticate(value: string | undefined): Promise<Identity | null> {
    return value?.startsWith("Bearer ") ? { subject: value.slice(7) } : null;
  }
}

class FixtureRepository implements CloudRepository {
  waterAlarmSettings: import("@modreef/api-contract").WaterAlarmSettings | undefined;
  async checkReadiness() {}
  private allowed(identity: Identity, aquariumId: string) {
    return memberships[identity.subject]?.includes(aquariumId) ?? false;
  }
  async listAquariums(identity: Identity) {
    return aquariums.filter((a) => this.allowed(identity, a.id)).map((a) => ({ ...a, role: roles[identity.subject]! }));
  }
  async listArchivedAquariums(_identity: Identity) {
    return [];
  }
  async createAquarium(identity: Identity, name: string) {
    return { id: `new-${identity.subject}`, name, role: "owner" as const, createdAt: "2026-01-01T00:00:00Z" };
  }
  async getAquarium(identity: Identity, id: string) {
    const aquarium = aquariums.find((a) => a.id === id);
    return this.allowed(identity, id) && aquarium ? { ...aquarium, role: roles[identity.subject]! } : null;
  }
  async renameAquarium(identity: Identity, id: string, name: string) {
    const aquarium = aquariums.find((candidate) => candidate.id === id);
    return this.allowed(identity, id) && roles[identity.subject] !== "viewer" && aquarium
      ? { ...aquarium, name, role: roles[identity.subject]! }
      : null;
  }
  async archiveAquarium(identity: Identity, id: string) {
    if (!this.allowed(identity, id) || roles[identity.subject] === "viewer") return null;
    if (id === "reef-a") return { status: "blocked" as const, controllerIds: ["edge-1"] };
    return {
      status: "archived" as const,
      aquarium: { ...aquariums.find((item) => item.id === id)!, role: roles[identity.subject]!, archivedAt: "2026-01-02T00:00:00Z" },
    };
  }
  async restoreAquarium(identity: Identity, id: string) {
    const aquarium = aquariums.find((item) => item.id === id);
    return this.allowed(identity, id) && roles[identity.subject] !== "viewer" && aquarium
      ? { ...aquarium, role: roles[identity.subject]!, archivedAt: null }
      : null;
  }
  async listEdges(identity: Identity, id: string): Promise<EdgeSummary[] | null> {
    return this.allowed(identity, id) ? [{ id: "edge-1", aquariumId: id, name: "Pi", status: "online", softwareVersion: "0.1", lastSeenAt: null, localHostname: null, runtimeState: { feedCycle: null } }] : null;
  }
  async renameEdge(identity: Identity, aquariumId: string, edgeId: string, name: string) {
    return this.allowed(identity, aquariumId) && roles[identity.subject] !== "viewer" && edgeId === "edge-1"
      ? { id: edgeId, aquariumId, name, status: "online" as const, softwareVersion: "0.1", lastSeenAt: null, localHostname: null, runtimeState: { feedCycle: null } }
      : null;
  }
  async retireEdge(identity: Identity, aquariumId: string, edgeId: string) {
    if (!this.allowed(identity, aquariumId) || roles[identity.subject] === "viewer") return null;
    if (edgeId === "edge-with-device") {
      return {
        status: "blocked" as const,
        deviceIds: ["strip-1"],
        equipmentIds: ["strip-1-outlet-1"],
      };
    }
    return edgeId === "edge-unused" || edgeId === "edge-1"
      ? { status: "retired" as const }
      : null;
  }
  async reprovisionEdge(identity: Identity, aquariumId: string, edgeId: string) {
    return this.allowed(identity, aquariumId) && roles[identity.subject] !== "viewer"
      ? { edgeId, aquariumId, token: "r".repeat(43) }
      : null;
  }
  async createLocalAuthorization(identity: Identity, aquariumId: string, _edgeId: string) {
    return this.allowed(identity, aquariumId) && roles[identity.subject] !== "viewer"
      ? { grant: "signed-grant", expiresAt: "2026-01-01T00:01:00Z" }
      : null;
  }
  async listEquipment(identity: Identity, id: string): Promise<CloudEquipmentSnapshot[] | null> {
    return this.allowed(identity, id) ? [] : null;
  }
  async listDevices(identity: Identity, id: string): Promise<CloudDeviceSnapshot[] | null> {
    return this.allowed(identity, id) ? [] : null;
  }
  async listEvents(identity: Identity, id: string): Promise<AquariumEvent[] | null> {
    return this.allowed(identity, id) ? [] : null;
  }
  async getWaterAlarmSettings(identity: Identity, id: string) {
    return this.allowed(identity, id) ? this.waterAlarmSettings : null;
  }
  async saveWaterAlarmSettings(identity: Identity, id: string, rules: import("@modreef/api-contract").WaterAlarmRules) {
    if (!this.allowed(identity, id) || roles[identity.subject] === "viewer") return null;
    this.waterAlarmSettings = {
      aquariumId: id, rules, revision: (this.waterAlarmSettings?.revision ?? 0) + 1,
      updatedAt: "2026-08-10T12:00:00Z",
    };
    return this.waterAlarmSettings;
  }
  async createCommand(identity: Identity, aquariumId: string, request: CloudCommandRequest): Promise<CloudCommand | null> {
    return this.allowed(identity, aquariumId) && roles[identity.subject] !== "viewer"
      ? { ...request, aquariumId, status: "queued", createdAt: "2026-01-01T00:00:00Z" }
      : null;
  }
  async getCommand(identity: Identity, aquariumId: string, commandId: string): Promise<CloudCommand | null> {
    return this.allowed(identity, aquariumId)
      ? {
          commandId, aquariumId, edgeId: "edge-1", equipmentId: "outlet-1",
          type: "equipment.swap-binding", payload: { otherEquipmentId: "outlet-2" },
          status: "completed", createdAt: "2026-01-01T00:00:00Z",
        }
      : null;
  }
  async registerEdge(identity: Identity, aquariumId: string, _name: string) {
    return this.allowed(identity, aquariumId) && roles[identity.subject] !== "viewer"
      ? { edgeId: "edge-new", aquariumId, token: "shown-once" }
      : null;
  }
  async synchronizeEdge(token: string, request: import("@modreef/api-contract").EdgeSyncRequest) {
    if (token !== "edge-secret" || request.edgeId !== "edge-1" || request.aquariumId !== "reef-a") return null;
    return { acceptedThroughSequence: request.events.at(-1)?.sequence ?? 0, acceptedCommandIds: [], commands: [], serverTime: "2026-01-01T00:00:00Z" };
  }
}

const app = new CloudApplication(new FixtureRepository(), new FixtureAuth());

describe("cloud aquarium tenancy", () => {
  it("reports liveness and database readiness without authentication", async () => {
    expect((await app.handle({ method: "GET", path: "/health/live" })).status).toBe(200);
    expect((await app.handle({ method: "GET", path: "/health/ready" })).status).toBe(200);
  });
  it("requires authentication", async () => {
    expect((await app.handle({ method: "GET", path: "/v1/aquariums" })).status).toBe(401);
  });
  it("returns an owned command's durable status", async () => {
    const response = await app.handle({
      method: "GET", path: "/v1/aquariums/reef-a/commands/swap-1",
      authorization: "Bearer alice",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ command: { commandId: "swap-1", status: "completed" } });
  });

  it("only lists the signed-in account's aquariums", async () => {
    const result = await app.handle({ method: "GET", path: "/v1/aquariums", authorization: "Bearer alice" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ aquariums: [aquariums[0]] });
  });

  it("lists physical devices as a first-class aquarium resource", async () => {
    const result = await app.handle({
      method: "GET",
      path: "/v1/aquariums/reef-a/devices",
      authorization: "Bearer alice",
    });
    expect(result).toEqual({ status: 200, body: { devices: [] } });
  });

  it("returns an authenticated Observer-mode Reef Coach report", async () => {
    const result = await app.handle({
      method: "GET",
      path: "/v1/aquariums/reef-a/coach",
      authorization: "Bearer alice",
    });
    expect(result).toMatchObject({
      status: 200,
      body: {
        report: {
          snapshot: { schemaVersion: "1", aquarium: { id: "reef-a" } },
          recommendation: { schemaVersion: "1", severity: "watch" },
        },
      },
    });
    expect((await app.handle({
      method: "GET",
      path: "/v1/aquariums/reef-b/coach",
      authorization: "Bearer alice",
    })).status).toBe(404);
  });

  it("falls back safely when model analysis is not configured", async () => {
    const result = await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/coach/analyze",
      authorization: "Bearer alice",
    });
    expect(result).toMatchObject({
      status: 200,
      body: { report: { generation: { mode: "deterministic" } } },
    });
  });

  it("uses the configured provider for an explicit model analysis", async () => {
    const provider = {
      name: "openai" as const, model: "test-model",
      analyze: async (snapshot: import("@modreef/api-contract").ReefSnapshot) => ({
        schemaVersion: "1" as const, generatedAt: snapshot.observedAt,
        summary: "Model-backed observer report", severity: "info" as const,
        confidence: "medium" as const, observations: [], hypotheses: [],
        recommendations: [], missingInformation: [],
      }),
    };
    const modelApp = new CloudApplication(new FixtureRepository(), new FixtureAuth(), provider);
    const result = await modelApp.handle({
      method: "POST", path: "/v1/aquariums/reef-a/coach/analyze",
      authorization: "Bearer alice",
    });
    expect(result).toMatchObject({
      status: 200,
      body: { report: {
        recommendation: { summary: "Model-backed observer report" },
        generation: { mode: "model", provider: "openai", model: "test-model" },
      } },
    });
  });

  it("shares all four water-quality alarm rules across authenticated clients", async () => {
    const rules = {
      ...defaultWaterAlarmRules,
      metrics: {
        ...defaultWaterAlarmRules.metrics,
        temperature: { ...defaultWaterAlarmRules.metrics.temperature, lower: 75, upper: 81 },
        ph: { ...defaultWaterAlarmRules.metrics.ph, lower: 7.7, upper: 8.6 },
        orp: { ...defaultWaterAlarmRules.metrics.orp, lower: 210, upper: 430 },
        salinity: { ...defaultWaterAlarmRules.metrics.salinity, lower: 32, upper: 37 },
      },
    };
    const saved = await app.handle({
      method: "PUT", path: "/v1/aquariums/reef-a/water-alarm-settings",
      authorization: "Bearer alice", body: { rules },
    });
    expect(saved).toMatchObject({ status: 200, body: { settings: { rules, revision: 1 } } });
    expect(await app.handle({
      method: "GET", path: "/v1/aquariums/reef-a/water-alarm-settings",
      authorization: "Bearer charlie",
    })).toMatchObject({ status: 200, body: { settings: { rules } } });
  });

  it("rejects incomplete water-quality alarm rules", async () => {
    expect((await app.handle({
      method: "PUT", path: "/v1/aquariums/reef-a/water-alarm-settings",
      authorization: "Bearer alice", body: { rules: { metrics: {} } },
    })).status).toBe(400);
  });

  it("hides another tenant's aquarium and resources", async () => {
    for (const path of ["/v1/aquariums/reef-b", "/v1/aquariums/reef-b/edges", "/v1/aquariums/reef-b/equipment", "/v1/aquariums/reef-b/events"]) {
      expect((await app.handle({ method: "GET", path, authorization: "Bearer alice" })).status).toBe(404);
    }
  });

  it("queues an idempotent command only for the account's aquarium", async () => {
    const body = { commandId: "command-123", edgeId: "edge-1", equipmentId: "pump-1", type: "equipment.set-power", payload: { on: false } };
    expect((await app.handle({ method: "POST", path: "/v1/aquariums/reef-a/commands", authorization: "Bearer alice", body })).status).toBe(202);
    expect((await app.handle({ method: "POST", path: "/v1/aquariums/reef-b/commands", authorization: "Bearer alice", body })).status).toBe(404);
  });

  it("creates an owner aquarium and returns Edge credentials once", async () => {
    const aquarium = await app.handle({ method: "POST", path: "/v1/aquariums", authorization: "Bearer alice", body: { name: "Frag Tank" } });
    expect(aquarium.status).toBe(201);
    const edge = await app.handle({ method: "POST", path: "/v1/aquariums/reef-a/edges", authorization: "Bearer alice", body: { name: "Beta Pi" } });
    expect(edge).toMatchObject({ status: 201, body: { credentials: { edgeId: "edge-new", token: "shown-once" } } });
  });

  it("renames an aquarium only for an aquarium administrator", async () => {
    expect((await app.handle({
      method: "PATCH", path: "/v1/aquariums/reef-a",
      authorization: "Bearer alice", body: { name: "  Display Reef  " },
    }))).toMatchObject({ status: 200, body: { aquarium: { name: "Display Reef" } } });
    expect((await app.handle({
      method: "PATCH", path: "/v1/aquariums/reef-a",
      authorization: "Bearer charlie", body: { name: "Nope" },
    })).status).toBe(404);
    expect((await app.handle({
      method: "PATCH", path: "/v1/aquariums/reef-a",
      authorization: "Bearer alice", body: { name: "  " },
    })).status).toBe(400);
  });

  it("archives only an empty aquarium and reports blocking controllers", async () => {
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/archive", authorization: "Bearer alice",
    }))).toMatchObject({
      status: 409,
      body: { code: "AQUARIUM_HAS_CONTROLLERS", controllerIds: ["edge-1"] },
    });
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-b/archive", authorization: "Bearer bob",
    }))).toMatchObject({ status: 200, body: { aquarium: { id: "reef-b" } } });
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/archive", authorization: "Bearer charlie",
    })).status).toBe(404);
  });

  it("restores an archived aquarium only for an administrator", async () => {
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-b/restore", authorization: "Bearer bob",
    }))).toMatchObject({ status: 200, body: { aquarium: { id: "reef-b", archivedAt: null } } });
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/restore", authorization: "Bearer charlie",
    })).status).toBe(404);
  });

  it("allows viewers to read but not register Edges or issue commands", async () => {
    expect((await app.handle({ method: "GET", path: "/v1/aquariums/reef-a", authorization: "Bearer charlie" })).status).toBe(200);
    expect((await app.handle({ method: "POST", path: "/v1/aquariums/reef-a/edges", authorization: "Bearer charlie", body: { name: "Nope" } })).status).toBe(404);
    const body = { commandId: "command-viewer", edgeId: "edge-1", equipmentId: "pump", type: "equipment.set-power", payload: { on: false } };
    expect((await app.handle({ method: "POST", path: "/v1/aquariums/reef-a/commands", authorization: "Bearer charlie", body })).status).toBe(404);
  });

  it("retires connected and unconnected controllers only for aquarium administrators", async () => {
    expect((await app.handle({
      method: "DELETE", path: "/v1/aquariums/reef-a/edges/edge-unused",
      authorization: "Bearer alice",
    })).status).toBe(200);
    expect((await app.handle({
      method: "DELETE", path: "/v1/aquariums/reef-a/edges/edge-1",
      authorization: "Bearer alice",
    })).status).toBe(200);
    expect((await app.handle({
      method: "DELETE", path: "/v1/aquariums/reef-a/edges/edge-unused",
      authorization: "Bearer charlie",
    })).status).toBe(404);
  });

  it("rejects controller removal while physical devices remain", async () => {
    expect((await app.handle({
      method: "DELETE", path: "/v1/aquariums/reef-a/edges/edge-with-device",
      authorization: "Bearer alice",
    }))).toMatchObject({
      status: 409,
      body: {
        code: "CONTROLLER_HAS_DEVICES",
        deviceIds: ["strip-1"],
        equipmentIds: ["strip-1-outlet-1"],
      },
    });
  });

  it("rotates controller credentials only for an aquarium administrator", async () => {
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/edges/edge-1/reprovision",
      authorization: "Bearer alice",
    }))).toMatchObject({ status: 200, body: { credentials: { edgeId: "edge-1" } } });
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/edges/edge-1/reprovision",
      authorization: "Bearer charlie",
    })).status).toBe(404);
  });

  it("issues local-administration grants only to aquarium administrators", async () => {
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/edges/edge-1/local-authorization",
      authorization: "Bearer alice",
    }))).toMatchObject({ status: 200, body: { authorization: { grant: "signed-grant" } } });
    expect((await app.handle({
      method: "POST", path: "/v1/aquariums/reef-a/edges/edge-1/local-authorization",
      authorization: "Bearer charlie",
    })).status).toBe(404);
  });

  it("renames a controller only for an aquarium administrator", async () => {
    expect((await app.handle({
      method: "PATCH", path: "/v1/aquariums/reef-a/edges/edge-1",
      authorization: "Bearer alice", body: { name: "  Sump Controller  " },
    }))).toMatchObject({ status: 200, body: { edge: { name: "Sump Controller" } } });
    expect((await app.handle({
      method: "PATCH", path: "/v1/aquariums/reef-a/edges/edge-1",
      authorization: "Bearer charlie", body: { name: "Nope" },
    })).status).toBe(404);
    expect((await app.handle({
      method: "PATCH", path: "/v1/aquariums/reef-a/edges/edge-1",
      authorization: "Bearer alice", body: { name: "  " },
    })).status).toBe(400);
  });
});

describe("Edge synchronization", () => {
  const body = { edgeId: "edge-1", aquariumId: "reef-a", softwareVersion: "0.1.0", uptimeSeconds: 10, localHostname: "test-edge", equipment: [], events: [], commandResults: [] };
  it("rejects missing or invalid device credentials", async () => {
    expect((await app.handle({ method: "POST", path: "/v1/edge/sync", body })).status).toBe(401);
    expect((await app.handle({ method: "POST", path: "/v1/edge/sync", authorization: "Bearer wrong", body })).status).toBe(401);
  });
  it("accepts a registered Edge independently of user OIDC", async () => {
    expect((await app.handle({ method: "POST", path: "/v1/edge/sync", authorization: "Bearer edge-secret", body })).status).toBe(200);
  });
});
