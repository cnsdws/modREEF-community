import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  isAvailableAsync: vi.fn(async () => false),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

afterEach(() => {
  vi.useRealTimers();
  storage.clear();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("browser Edge authorization persistence", () => {
  it("restores cloud-authorized local administration after reload", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ authorization: { token: "edge-token", expiresAt } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    const firstLoad = await import("../src/edgeClient");
    await firstLoad.authorizeLocalEdgeFromCloud("http://modreef.local:3000", "grant");

    expect(
      JSON.parse(
        storage.get("modreef.controller.local-authorization") ?? "{}",
      ),
    ).toMatchObject({ token: "edge-token", expiresAt });

    vi.resetModules();
    const reloaded = await import("../src/edgeClient");
    await expect(reloaded.initializeLocalAuthorization()).resolves.toBe(
      true,
    );
    expect(fetch).toHaveBeenLastCalledWith(
      "http://modreef.local:3000/onboarding/authorization",
      expect.objectContaining({
        headers: { Authorization: "Bearer edge-token" },
      }),
    );
  });

  it("removes an expired browser authorization", async () => {
    storage.set(
      "modreef.controller.local-authorization",
      JSON.stringify({
        token: "expired-token",
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );

    const edgeClient = await import("../src/edgeClient");
    await expect(edgeClient.initializeLocalAuthorization()).resolves.toBe(
      false,
    );
    expect(storage.has("modreef.edge.onboarding-authorization")).toBe(false);
  });

  it("retries authorization restoration after an initial missing credential", async () => {
    const edgeClient = await import("../src/edgeClient");
    await expect(edgeClient.initializeLocalAuthorization()).resolves.toBe(false);

    storage.set(
      "modreef.controller.local-authorization",
      JSON.stringify({
        token: "late-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(edgeClient.initializeLocalAuthorization()).resolves.toBe(true);
  });

  it("keeps Reef Controller authorizations isolated by cloud identity", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authorization: { token: "controller-two-token", expiresAt } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    const edgeClient = await import("../src/edgeClient");
    await edgeClient.configureEdgeTarget({
      edgeId: "edge-2",
      name: "Prototype 2",
      url: "http://modreef-02.local:3000",
    });
    await edgeClient.authorizeLocalEdgeFromCloud("http://modreef-02.local:3000", "grant");

    expect(JSON.parse(
      storage.get("modreef.controller.local-authorization.edge-2") ?? "{}",
    )).toMatchObject({ token: "controller-two-token", expiresAt });
    expect(storage.has("modreef.edge.onboarding-authorization")).toBe(false);
  });

  it("migrates a legacy authorization without requiring pairing again", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    storage.set("modreef.edge.onboarding-authorization", JSON.stringify({
      token: "legacy-token", expiresAt,
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const edgeClient = await import("../src/edgeClient");
    await expect(edgeClient.initializeLocalAuthorization()).resolves.toBe(true);
    expect(storage.has("modreef.edge.onboarding-authorization")).toBe(false);
    expect(storage.has("modreef.controller.local-authorization")).toBe(true);
  });

  it("rejects a local controller whose identity differs from the cloud record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        name: "modREEF Edge",
        version: "0.1.0",
        status: "healthy",
        checks: [],
        hostname: "modreef-01",
        edgeId: "edge-1",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 30,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ));
    const edgeClient = await import("../src/edgeClient");
    await expect(edgeClient.probeEdgeTarget({
      edgeId: "edge-2",
      name: "Prototype 2",
      url: "http://modreef-02.local:3000",
    })).rejects.toThrow("identity does not match");
  });

  it("reconciles a committed claim when the claim response is lost", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("Fetch request cancelled"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "modREEF Edge",
        version: "0.1.0",
        status: "healthy",
        checks: [],
        hostname: "modreef-01",
        claimed: true,
        edgeId: "edge-1",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 30,
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const edgeClient = await import("../src/edgeClient");
    await expect(edgeClient.claimLocalEdge("http://modreef-01.local:3000", {
      edgeId: "edge-1",
      aquariumId: "reef-1",
      token: "one-time-token",
    })).resolves.toBeUndefined();
  });

  it("stops waiting when a committed claim request never settles", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "modREEF Edge",
        version: "0.1.0",
        status: "healthy",
        checks: [],
        hostname: "modreef-01",
        claimed: true,
        edgeId: "edge-1",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 30,
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const edgeClient = await import("../src/edgeClient");
    const claim = edgeClient.claimLocalEdge("http://modreef-01.local:3000", {
      edgeId: "edge-1",
      aquariumId: "reef-1",
      token: "one-time-token",
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(claim).resolves.toBeUndefined();
  });

  it("does not accept a lost response from a different claimed controller", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("Fetch request cancelled"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: "modREEF Edge",
        version: "0.1.0",
        status: "healthy",
        checks: [],
        hostname: "modreef-02",
        claimed: true,
        edgeId: "edge-2",
        timestamp: new Date().toISOString(),
        uptimeSeconds: 30,
      }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const edgeClient = await import("../src/edgeClient");
    await expect(edgeClient.claimLocalEdge("http://modreef-02.local:3000", {
      edgeId: "edge-1",
      aquariumId: "reef-1",
      token: "one-time-token",
    })).rejects.toThrow("Fetch request cancelled");
  });
});
