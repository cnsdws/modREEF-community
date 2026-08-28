import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

export const dataDirectory = process.env.MODREEF_DATA_DIR ?? join(repositoryRoot, ".data");

export const deviceCredentialPath = process.env.MODREEF_ENV_FILE
  ? resolve(repositoryRoot, process.env.MODREEF_ENV_FILE)
  : join(dataDirectory, "device-credentials.env");

mkdirSync(dataDirectory, { recursive: true });
