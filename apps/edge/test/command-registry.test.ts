import { describe, expect, it } from "vitest";

import {
  CommandIdConflictError,
  CommandRegistry,
} from "../src/command-registry.js";

describe("CommandRegistry", () => {
  it("never executes a duplicate dose command", async () => {
    const registry = new CommandRegistry();
    let doses = 0;
    const operation = async () => {
      doses += 1;
      await Promise.resolve();
      return "completed";
    };

    const [first, retry] = await Promise.all([
      registry.execute("command-1", "dose:60", operation),
      registry.execute("command-1", "dose:60", operation),
    ]);

    expect(doses).toBe(1);
    expect(first).toEqual({ result: "completed", replayed: false });
    expect(retry).toEqual({ result: "completed", replayed: true });
  });

  it("rejects reuse of an ID for different input", async () => {
    const registry = new CommandRegistry();
    await registry.execute("command-1", "power:true", async () => true);

    expect(() =>
      registry.execute("command-1", "power:false", async () => false),
    ).toThrow(CommandIdConflictError);
  });
});
