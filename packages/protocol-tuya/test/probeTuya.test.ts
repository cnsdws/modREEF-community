import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { probeTuya } from "../src/probe.js";

describe("probeTuya", () => {
  it("reports a reachable TCP endpoint", async () => {
    const server = createServer();

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }

    const result = await probeTuya(
      "127.0.0.1",
      address.port,
      500,
    );

    server.close();

    expect(result.reachable).toBe(true);
    expect(result.port).toBe(address.port);
  });

  it("reports an unreachable TCP endpoint", async () => {
    const result = await probeTuya(
      "127.0.0.1",
      1,
      200,
    );

    expect(result.reachable).toBe(false);
  });
});
