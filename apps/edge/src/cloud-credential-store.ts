import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { EdgeCloudConfig } from "./cloud-sync.js";

const dataDirectory = process.env.MODREEF_DATA_DIR ?? ".data";
const credentialPath = resolve(dataDirectory, "cloud-credentials.json");

export function loadCloudCredentials(): EdgeCloudConfig | undefined {
  try {
    const parsed = JSON.parse(readFileSync(credentialPath, "utf8")) as EdgeCloudConfig;
    if (!parsed.cloudUrl || !parsed.edgeId || !parsed.aquariumId || !parsed.token) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveCloudCredentials(credentials: EdgeCloudConfig): void {
  mkdirSync(dirname(credentialPath), { recursive: true });
  const temporaryPath = `${credentialPath}.new`;
  writeFileSync(temporaryPath, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, credentialPath);
}

export function deleteCloudCredentials(): void {
  try {
    unlinkSync(credentialPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
