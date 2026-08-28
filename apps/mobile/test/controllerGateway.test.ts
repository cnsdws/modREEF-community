import { describe, expect, it, vi } from "vitest";
import { executeControllerCommand } from "../src/controllerGateway";

describe("controller command gateway", () => {
  it("uses LAN without duplicating a successful command in the cloud", async () => {
    const local = vi.fn(async () => "local");
    const cloud = vi.fn(async () => "cloud");
    await expect(executeControllerCommand({ preferLocal: true, local, cloud })).resolves.toBe("local");
    expect(local).toHaveBeenCalledOnce();
    expect(cloud).not.toHaveBeenCalled();
  });

  it("falls back to cloud when LAN delivery fails", async () => {
    const local = vi.fn(async () => { throw new Error("offline"); });
    const cloud = vi.fn(async () => "cloud");
    await expect(executeControllerCommand({ preferLocal: true, local, cloud })).resolves.toBe("cloud");
    expect(cloud).toHaveBeenCalledOnce();
  });

  it("routes website commands directly to cloud", async () => {
    const local = vi.fn(async () => "local");
    const cloud = vi.fn(async () => "cloud");
    await expect(executeControllerCommand({ preferLocal: false, local, cloud })).resolves.toBe("cloud");
    expect(local).not.toHaveBeenCalled();
  });
});
