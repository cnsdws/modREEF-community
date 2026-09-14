import { afterEach, describe, expect, it, vi } from "vitest";
import { createHealthResponse } from "../src/index";

describe("Edge health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an evaluated health response", () => {
    const result = createHealthResponse();

    expect(result.name).toBe("modREEF Edge");
    expect(["healthy", "degraded", "unhealthy"]).toContain(
      result.status,
    );
    expect(result.version).toBe("0.2.2");
    expect(typeof result.claimed).toBe("boolean");
    expect(result.setupId).toMatch(/^[A-F0-9]{6}$/);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    expect(result.checks.map((check) => check.name)).toEqual([
      "database",
      "automation",
      "clock",
      "storage",
      "equipment",
    ]);
    expect(result.checks.every((check) => check.message.length > 0)).toBe(
      true,
    );

    const statusRank = {
      healthy: 0,
      degraded: 1,
      unhealthy: 2,
    } as const;
    const worstCheck = Math.max(
      ...result.checks.map((check) => statusRank[check.status]),
    );

    expect(statusRank[result.status]).toBe(worstCheck);
  });

  it("reports process uptime from a monotonic clock", () => {
    vi.spyOn(process, "uptime").mockReturnValue(42.9);

    expect(createHealthResponse().uptimeSeconds).toBe(42);
  });
});
