import { describe, expect, it } from "vitest";

import { discoverReefControllers } from "../src/controllerDiscovery";

describe("browser controller discovery fallback", () => {
  it("does not invent a hostname when Bonjour enumeration is unavailable", async () => {
    await expect(discoverReefControllers()).resolves.toEqual([]);
  });
});
