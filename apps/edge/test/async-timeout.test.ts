import { describe, expect, it, vi } from "vitest";
import { OperationTimeoutError, withTimeout } from "../src/async-timeout.js";

describe("bounded controller operations", () => {
  it("returns an operation that completes before its deadline", async () => {
    await expect(withTimeout(Promise.resolve("ready"), 100, "device setup"))
      .resolves.toBe("ready");
  });

  it("releases callers when a device operation never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(
        new Promise<never>(() => undefined),
        5_000,
        "device setup",
      );
      const rejection = expect(pending).rejects.toEqual(
        new OperationTimeoutError("device setup", 5_000),
      );

      await vi.advanceTimersByTimeAsync(5_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
