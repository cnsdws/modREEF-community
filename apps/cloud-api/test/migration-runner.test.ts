import { describe, expect, it } from "vitest";
import { runMigrations, type MigrationClient } from "../src/migration-runner.js";

class FakeClient implements MigrationClient {
  readonly applied = new Map<string, string>();
  readonly statements: string[] = [];
  async query<T>(text: string, values: unknown[] = []) {
    this.statements.push(text);
    if (text.startsWith("SELECT checksum")) {
      const checksum = this.applied.get(String(values[0]));
      return { rows: (checksum ? [{ checksum }] : []) as T[], rowCount: checksum ? 1 : 0 };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      this.applied.set(String(values[0]), String(values[1]));
    }
    return { rows: [] as T[], rowCount: 0 };
  }
}

describe("cloud migration runner", () => {
  it("applies migrations once in filename order", async () => {
    const client = new FakeClient();
    const migrations = [{ name: "002.sql", sql: "SELECT 2" }, { name: "001.sql", sql: "SELECT 1" }];
    await runMigrations(client, migrations);
    await runMigrations(client, migrations);
    expect(client.statements.filter((item) => item === "SELECT 1")).toHaveLength(1);
    expect(client.statements.filter((item) => item === "SELECT 2")).toHaveLength(1);
  });

  it("refuses a modified migration that was already applied", async () => {
    const client = new FakeClient();
    await runMigrations(client, [{ name: "001.sql", sql: "SELECT 1" }]);
    await expect(runMigrations(client, [{ name: "001.sql", sql: "SELECT changed" }]))
      .rejects.toThrow("Applied migration was modified");
  });
});
