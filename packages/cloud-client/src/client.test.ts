import { describe, expect, it, vi } from "vitest";
import { FetchModReefTransport, ModReefCloudClient, ModReefHttpError, type ModReefTransport } from "./index.js";
import { defaultWaterAlarmRules } from "@modreef/api-contract";

describe("ModReefCloudClient", () => {
  it("creates aquariums and registers Edges through the shared transport", async () => {
    const request = vi.fn(async ({ path }: { path: string }) => path.endsWith("/edges")
      ? { credentials: { edgeId: "edge-1", aquariumId: "reef/one", token: "once" } }
      : { aquarium: { id: "reef/one", name: "Reef", role: "owner", createdAt: "now" } });
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect((await client.createAquarium("Reef")).role).toBe("owner");
    expect((await client.registerEdge("reef/one", "Pi")).token).toBe("once");
    expect(request.mock.calls[1]?.[0].path).toBe("/v1/aquariums/reef%2Fone/edges");
  });

  it("reads Edge events synchronized through the cloud", async () => {
    const request = vi.fn(async () => ({ events: [{ eventId: "event-1" }] }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.listEvents("reef/one")).toEqual([{ eventId: "event-1" }]);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/aquariums/reef%2Fone/events",
    });
  });

  it("reads durable command completion through the aquarium-scoped endpoint", async () => {
    const command = { commandId: "swap/1", status: "completed" };
    const request = vi.fn(async () => ({ command }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.getCommand("reef/one", "swap/1")).toEqual(command);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/aquariums/reef%2Fone/commands/swap%2F1",
    });
  });

  it("reads physical devices independently from equipment channels", async () => {
    const request = vi.fn(async () => ({ devices: [{ deviceId: "device-1" }] }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.listDevices("reef/one")).toEqual([{ deviceId: "device-1" }]);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/aquariums/reef%2Fone/devices",
    });
  });

  it("reads a versioned Reef Coach report", async () => {
    const report = {
      snapshot: { schemaVersion: "1" },
      recommendation: { schemaVersion: "1", summary: "Stable" },
    };
    const request = vi.fn(async () => ({ report }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.getReefCoachReport("reef/one")).toEqual(report);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/aquariums/reef%2Fone/coach",
    });
  });

  it("explicitly requests a Reef Coach model analysis", async () => {
    const report = { snapshot: { schemaVersion: "1" }, recommendation: { summary: "Review pH" } };
    const request = vi.fn(async () => ({ report }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.analyzeReefCoach("reef/one")).toEqual(report);
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/aquariums/reef%2Fone/coach/analyze",
    });
  });

  it("reads and saves shared water alarm settings", async () => {
    const settings = { aquariumId: "reef/one", revision: 2, updatedAt: "now", rules: defaultWaterAlarmRules };
    const request = vi.fn(async ({ method }: { method: string }) => method === "GET"
      ? { settings: null } : { settings });
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.getWaterAlarmSettings("reef/one")).toBeNull();
    expect(await client.saveWaterAlarmSettings("reef/one", defaultWaterAlarmRules)).toEqual(settings);
    expect(request.mock.calls[1]?.[0]).toEqual({
      method: "PUT", path: "/v1/aquariums/reef%2Fone/water-alarm-settings",
      body: { rules: defaultWaterAlarmRules },
    });
  });

  it("renames an Edge through the aquarium-scoped endpoint", async () => {
    const request = vi.fn(async () => ({ edge: { id: "edge-1", name: "Sump Controller" } }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect((await client.renameEdge("reef/one", "edge/1", "Sump Controller")).name).toBe("Sump Controller");
    expect(request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/v1/aquariums/reef%2Fone/edges/edge%2F1",
      body: { name: "Sump Controller" },
    });
  });

  it("uses the shared aquarium archive and restore lifecycle", async () => {
    const request = vi.fn(async ({ path }: { path: string }) => ({
      aquarium: {
        id: "reef/one",
        name: "Reef",
        role: "owner",
        createdAt: "now",
        archivedAt: path.endsWith("/archive") ? "later" : null,
      },
    }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect((await client.archiveAquarium("reef/one")).archivedAt).toBe("later");
    expect((await client.restoreAquarium("reef/one")).archivedAt).toBeNull();
    expect(request.mock.calls.map(([call]) => call)).toEqual([
      { method: "POST", path: "/v1/aquariums/reef%2Fone/archive" },
      { method: "POST", path: "/v1/aquariums/reef%2Fone/restore" },
    ]);
  });

  it("lists archived aquariums separately from the active selector", async () => {
    const request = vi.fn(async () => ({ aquariums: [{ id: "reef-old" }] }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.listArchivedAquariums()).toEqual([{ id: "reef-old" }]);
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/aquariums/archived",
    });
  });

  it("requests a controller-scoped local-administration grant", async () => {
    const request = vi.fn(async () => ({
      authorization: { grant: "signed-grant", expiresAt: "soon" },
    }));
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect((await client.createLocalAuthorization("reef/one", "edge/1")).grant)
      .toBe("signed-grant");
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/v1/aquariums/reef%2Fone/edges/edge%2F1/local-authorization",
    });
  });

  it("manages aquarium authorization and alarm preferences", async () => {
    const member = {
      userId: "user/2", email: "helper@example.com", role: "control" as const,
      receiveAlarms: true, joinedAt: "now",
    };
    let response: unknown = { members: [member] };
    const request = vi.fn(async (_request: unknown) => response);
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect(await client.listAquariumMembers("reef/one")).toEqual([member]);
    response = { member };
    await client.addAquariumMember("reef/one", member.email, "control");
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "POST", path: "/v1/aquariums/reef%2Fone/members",
      body: { email: member.email, role: "control", receiveAlarms: true },
    });
    await client.updateAquariumMember("reef/one", "user/2", { receiveAlarms: false });
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "PATCH", path: "/v1/aquariums/reef%2Fone/members/user%2F2",
      body: { receiveAlarms: false },
    });
    await client.removeAquariumMember("reef/one", "user/2");
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "DELETE", path: "/v1/aquariums/reef%2Fone/members/user%2F2",
    });
    await client.resendAquariumInvitation("reef/one", "user/2");
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "POST", path: "/v1/aquariums/reef%2Fone/members/user%2F2/resend",
    });
    response = { members: [member] };
    await client.transferAquariumOwnership("reef/one", "user/2");
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "POST", path: "/v1/aquariums/reef%2Fone/members/user%2F2/transfer-ownership",
    });
    response = { events: [] };
    await client.listAuthorizationAudit("reef/one");
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "GET", path: "/v1/aquariums/reef%2Fone/authorization-audit",
    });
  });

  it("exports an aquarium and requests safe account deletion", async () => {
    let response: unknown = {
      export: {
        schemaVersion: "1", exportedAt: "now",
        aquarium: { id: "reef", name: "Reef", role: "owner", createdAt: "now" },
        controllers: [], devices: [], equipment: [], events: [], waterAlarmSettings: null,
        members: [], authorizationAudit: [],
      },
    };
    const request = vi.fn(async (_request: unknown) => response);
    const client = new ModReefCloudClient({ request } as unknown as ModReefTransport);
    expect((await client.exportAquarium("reef/one")).schemaVersion).toBe("1");
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      method: "GET", path: "/v1/aquariums/reef%2Fone/export",
    });
    response = { deleted: true };
    await client.deleteAccount();
    expect(request.mock.calls.at(-1)?.[0]).toEqual({ method: "DELETE", path: "/v1/account" });
  });
});

describe("FetchModReefTransport", () => {
  it("requires a token before making a request", async () => {
    const transport = new FetchModReefTransport("https://api.modreef.test", async () => null);
    await expect(transport.request({ method: "GET", path: "/v1/aquariums" })).rejects.toEqual(
      expect.objectContaining<Partial<ModReefHttpError>>({ status: 401 }),
    );
  });

  it("bounds cloud requests so dashboard refresh can recover", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ aquariums: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const transport = new FetchModReefTransport(
      "https://api.modreef.test",
      async () => "token",
      25,
    );

    await transport.request({ method: "GET", path: "/v1/aquariums" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.modreef.test/v1/aquariums",
      expect.objectContaining({
        cache: "no-store",
        headers: { authorization: "Bearer token" },
      }),
    );
    fetchMock.mockRestore();
  });

  it("times out without aborting React Native's fetch bridge", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => undefined),
    );
    const transport = new FetchModReefTransport(
      "https://api.modreef.test",
      async () => "token",
      5,
    );

    await expect(
      transport.request({ method: "GET", path: "/v1/aquariums" }),
    ).rejects.toThrow("timed out after 5 ms");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.modreef.test/v1/aquariums",
      expect.not.objectContaining({ signal: expect.anything() }),
    );
    fetchMock.mockRestore();
  });

  it("does not apply read-cache options to mutations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ aquarium: { id: "reef" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const transport = new FetchModReefTransport(
      "https://api.modreef.test",
      async () => "token",
    );

    await transport.request({
      method: "POST",
      path: "/v1/aquariums",
      body: { name: "Reef" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.modreef.test/v1/aquariums",
      expect.not.objectContaining({ cache: "no-store" }),
    );
    fetchMock.mockRestore();
  });
});
