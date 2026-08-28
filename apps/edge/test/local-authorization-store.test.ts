import { describe, expect, it } from "vitest";

import { LocalAuthorizationStore } from "../src/local-authorization-store.js";

class MemoryStateStore {
  private values = new Map<string, unknown>();
  loadState<T>(key: string): T | undefined {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  saveState<T>(key: string, value: T): void {
    this.values.set(key, structuredClone(value));
  }
}

describe("LocalAuthorizationStore", () => {
  it("authorizes a cloud-approved client without a display code", () => {
    const authorizations = new LocalAuthorizationStore(() => 1_000, () => "trusted-token");
    expect(authorizations.authorizeTrustedClient().token).toBe("trusted-token");
    expect(authorizations.isAuthorized("trusted-token")).toBe(true);
  });

  it("persists only hashed authorization across controller restarts", () => {
    const store = new MemoryStateStore();
    const first = new LocalAuthorizationStore(() => 1_000, () => "secret-token", store);
    first.authorizeTrustedClient();
    expect(JSON.stringify(store.loadState("edge-authorized-clients"))).not.toContain("secret-token");
    const restarted = new LocalAuthorizationStore(() => 2_000, undefined, store);
    expect(restarted.isAuthorized("secret-token")).toBe(true);
    expect(restarted.isAuthorized("wrong-token")).toBe(false);
  });

  it("rejects expired authorization", () => {
    let now = 1_000;
    const authorizations = new LocalAuthorizationStore(() => now, () => "token");
    authorizations.authorizeTrustedClient();
    now += 90 * 24 * 60 * 60 * 1_000;
    expect(authorizations.isAuthorized("token")).toBe(false);
  });
});
