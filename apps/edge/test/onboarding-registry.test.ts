import { describe, expect, it } from "vitest";

import {
  OnboardingRegistry,
  type RegisteredEquipment,
} from "../src/onboarding-registry.js";

class MemoryStateStore {
  private values = new Map<string, unknown>();

  loadState<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  saveState<T>(key: string, value: T): void {
    this.values.set(key, structuredClone(value));
  }
}

describe("OnboardingRegistry", () => {
  it("persists registered non-secret equipment metadata", () => {
    const store = new MemoryStateStore();
    const registry = new OnboardingRegistry(
      store,
      () => new Date("2026-07-16T19:00:00.000Z"),
    );

    expect(
      registry.register({
        deviceId: "device-1",
        displayName: "GHome WP12",
        transport: "bluetooth-le",
        manufacturer: "GHome",
        model: "WP12",
        networkAddress: "192.168.1.50",
        commissioningId: "tuya-commissioning-uuid",
      }),
    ).toEqual({
      deviceId: "device-1",
      displayName: "GHome WP12",
      transport: "bluetooth-le",
      manufacturer: "GHome",
      model: "WP12",
      networkAddress: "192.168.1.50",
      commissioningId: "tuya-commissioning-uuid",
      registeredAt: "2026-07-16T19:00:00.000Z",
    });

    const reloaded = new OnboardingRegistry(store);
    expect(reloaded.list()).toHaveLength(1);
  });

  it("replaces an existing registration by device ID", () => {
    const store = new MemoryStateStore();
    const registry = new OnboardingRegistry(store);

    registry.register({
      deviceId: "device-1",
      displayName: "Original",
      transport: "bluetooth-le",
    });

    registry.register({
      deviceId: "device-1",
      displayName: "Updated",
      transport: "bluetooth-le",
    });

    const records: RegisteredEquipment[] = registry.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.displayName).toBe("Updated");
  });

  it("removes only the matching device registration", () => {
    const store = new MemoryStateStore();
    const registry = new OnboardingRegistry(store);
    registry.register({
      deviceId: "device-1",
      displayName: "First",
      transport: "bluetooth-le",
    });
    registry.register({
      deviceId: "device-2",
      displayName: "Second",
      transport: "bluetooth-le",
    });

    expect(registry.remove("device-1")?.displayName).toBe("First");
    expect(registry.list().map(({ deviceId }) => deviceId)).toEqual(["device-2"]);
    expect(registry.remove("missing")).toBeNull();
  });
});
