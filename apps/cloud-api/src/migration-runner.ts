import { createHash } from "node:crypto";

export interface MigrationClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface Migration {
  name: string;
  sql: string;
}

export async function runMigrations(client: MigrationClient, migrations: Migration[]): Promise<void> {
  await client.query("SELECT pg_advisory_lock(hashtext('modreef-cloud-migrations'))");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
      const checksum = createHash("sha256").update(migration.sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1", [migration.name],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${migration.name}`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('modreef-cloud-migrations'))");
  }
}
