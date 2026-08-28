import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { runMigrations } from "./migration-runner.js";

const databaseUrl = process.env.MODREEF_DATABASE_URL;
if (!databaseUrl) throw new Error("MODREEF_DATABASE_URL is required");
const migrationDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const names = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
const migrations = await Promise.all(names.map(async (name) => ({
  name,
  sql: await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), "utf8"),
})));
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await runMigrations(client, migrations);
  console.log("Cloud foundation migration complete");
} finally {
  client.release();
  await pool.end();
}
