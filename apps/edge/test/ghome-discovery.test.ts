import { describe, expect, it, vi } from "vitest";

import { GHomeDiscovery } from "../src/ghome-discovery.js";

describe("GHomeDiscovery", () => {
  it("returns a private address from the discovery process", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "10.0.0.50\n",
    });
    const discovery = new GHomeDiscovery(
      "/opt/modreef/app",
      "/opt/modreef/app/.venv/bin/python",
      run,
    );

    await expect(
      discovery.findPrivateAddress("device-1"),
    ).resolves.toBe("10.0.0.50");

    expect(run).toHaveBeenCalledWith(
      "/opt/modreef/app/.venv/bin/python",
      ["scripts/tuya-discover.py", "device-1"],
      {
        cwd: "/opt/modreef/app",
        timeout: 30_000,
      },
    );
  });

  it("rejects public and malformed addresses", async () => {
    for (const address of ["73.217.1.29", "not-an-ip"]) {
      const discovery = new GHomeDiscovery(
        "/repo",
        "python3",
        vi.fn().mockResolvedValue({
          stdout: `${address}\n`,
        }),
      );

      await expect(
        discovery.findPrivateAddress("device-1"),
      ).rejects.toThrow("private IPv4");
    }
  });
});
