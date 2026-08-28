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
  storage.clear();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("browser cloud session persistence", () => {
  it("restores the access token after an application reload", async () => {
    const firstLoad = await import("../src/dashboardConnection");
    await firstLoad.setCloudAccessToken("cloud-token");

    expect(storage.get("modreef.cloud.access-token")).toBe("cloud-token");

    vi.resetModules();
    const reloaded = await import("../src/dashboardConnection");
    await expect(reloaded.getCloudAccessToken()).resolves.toBe("cloud-token");
  });

  it("removes the browser token during sign out", async () => {
    storage.set("modreef.cloud.access-token", "cloud-token");
    storage.set("modreef.cloud.refresh-token", "refresh-token");
    const dashboardConnection = await import("../src/dashboardConnection");

    await dashboardConnection.clearCloudSession();

    expect(storage.has("modreef.cloud.access-token")).toBe(false);
    expect(storage.has("modreef.cloud.refresh-token")).toBe(false);
    await expect(dashboardConnection.getCloudAccessToken()).resolves.toBeNull();
    await expect(dashboardConnection.getCloudRefreshToken()).resolves.toBeNull();
  });

  it("restores the refresh token after an application reload", async () => {
    const firstLoad = await import("../src/dashboardConnection");
    await firstLoad.setCloudRefreshToken("refresh-token");

    vi.resetModules();
    const reloaded = await import("../src/dashboardConnection");
    await expect(reloaded.getCloudRefreshToken()).resolves.toBe("refresh-token");
  });

  it("clears a cloud token rejected by the API", async () => {
    storage.set("modreef.cloud.access-token", "expired-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    const dashboardConnection = await import("../src/dashboardConnection");

    await expect(dashboardConnection.validateCloudAccessToken()).resolves.toBe(false);
    expect(storage.has("modreef.cloud.access-token")).toBe(false);
  });
});
