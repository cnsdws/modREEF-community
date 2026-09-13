import { describe, expect, it } from "vitest";

import { MatterLifecycleCoordinator } from "../src/matter-lifecycle.js";
import {
  isOperationalHandoffFailure,
  isRecoverableMatterPairingFailure,
  isTapoP316mMatterDevice,
} from "../src/controller.js";

describe("MatterLifecycleCoordinator", () => {
  it("recognizes the P316M identity encoded in its Matter QR payload", () => {
    expect(isTapoP316mMatterDevice(5010, 274)).toBe(true);
    expect(isTapoP316mMatterDevice(5010, 275)).toBe(false);
    expect(isTapoP316mMatterDevice(1234, 274)).toBe(false);
  });

  it("classifies transient BLE and operational handoff failures for one retry", () => {
    expect(isRecoverableMatterPairingFailure(
      new Error("[peer-communication] Could not connect to device"),
    )).toBe(true);
    expect(isRecoverableMatterPairingFailure(
      new Error("[ble] Failed to connect to peripheral 00:11"),
    )).toBe(true);
    expect(isRecoverableMatterPairingFailure(
      new Error("[discovery-aggregate] No device could be commissioned (1 of 1 started attempt(s) failed, 1 discovered)"),
    )).toBe(true);
    expect(isOperationalHandoffFailure(
      new Error("[operative-connection-failed] peer-unreachable"),
    )).toBe(true);
    expect(isRecoverableMatterPairingFailure(
      new Error("The setup code is invalid"),
    )).toBe(false);
  });

  it("supports repeated commission and verified delete cycles", async () => {
    const lifecycle = new MatterLifecycleCoordinator();
    const nodes = new Set<string>();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const node = await lifecycle.commission({
        attempt: async () => {
          nodes.add("matter-1");
          return "matter-1";
        },
        isRecoverable: () => false,
      });
      expect(node).toBe("matter-1");
      expect(nodes.has(node)).toBe(true);

      await lifecycle.remove({
        label: node,
        isPresent: () => nodes.has(node),
        remove: async () => { nodes.delete(node); },
      });
      expect(nodes.has(node)).toBe(false);
    }

  });

  it("retries one recoverable operational handoff with fresh state", async () => {
    const lifecycle = new MatterLifecycleCoordinator();
    let attempts = 0;
    let recoveries = 0;

    const result = await lifecycle.commission({
      attempt: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("peer-unreachable");
        return "matter-2";
      },
      isRecoverable: (error) => String(error).includes("peer-unreachable"),
      onRecovering: () => { recoveries += 1; },
    });

    expect(result).toBe("matter-2");
    expect(attempts).toBe(2);
    expect(recoveries).toBe(1);
  });

  it("cleans up after the single recovery attempt also fails", async () => {
    const lifecycle = new MatterLifecycleCoordinator();
    let attempts = 0;

    await expect(lifecycle.commission({
      attempt: async () => {
        attempts += 1;
        throw new Error("peer-unreachable");
      },
      isRecoverable: () => true,
    })).rejects.toThrow("peer-unreachable");

    expect(attempts).toBe(2);
  });

  it("does not report deletion while the node remains commissioned", async () => {
    const lifecycle = new MatterLifecycleCoordinator();
    let present = true;

    await expect(lifecycle.remove({
      label: "matter-3",
      isPresent: () => present,
      remove: async () => { /* device rejected removal */ },
    })).rejects.toThrow("remained commissioned after deletion");
  });
});
