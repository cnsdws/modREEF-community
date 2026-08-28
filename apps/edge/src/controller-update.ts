import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import type { ControllerUpdateRuntimeState } from "@modreef/api-contract";

function paths() {
  const dataDirectory = process.env.MODREEF_DATA_DIR ?? "/var/lib/modreef";
  return {
    currentReleasePath: `${dataDirectory}/release.sha256`,
    statusPath: `${dataDirectory}/update-status.json`,
    requestPath: `${dataDirectory}/update.request`,
    releaseChannelPath: `${dataDirectory}/release-channel`,
  };
}

export type ControllerReleaseChannel = "production" | "staging";

export function getControllerReleaseChannel(): ControllerReleaseChannel {
  try {
    return readFileSync(paths().releaseChannelPath, "utf8").trim() === "staging"
      ? "staging"
      : "production";
  } catch {
    return "production";
  }
}

function installedRelease(): string | undefined {
  try {
    const value = readFileSync(paths().currentReleasePath, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function getControllerUpdateStatus(): ControllerUpdateRuntimeState {
  try {
    const status = JSON.parse(readFileSync(paths().statusPath, "utf8")) as ControllerUpdateRuntimeState;
    if (status && typeof status.status === "string" && typeof status.automaticUpdatesEnabled === "boolean") {
      return { ...status, releaseChannel: getControllerReleaseChannel() };
    }
  } catch {
    // A controller upgraded from an older release will not have a status file yet.
  }
  const release = installedRelease();
  return {
    status: "idle",
    ...(release ? { installedRelease: release } : {}),
    automaticUpdatesEnabled: existsSync("/etc/systemd/system/modreef-update.timer"),
    releaseChannel: getControllerReleaseChannel(),
  };
}

export async function requestControllerUpdate(): Promise<void> {
  const release = installedRelease();
  const requested: ControllerUpdateRuntimeState = {
    status: "requested",
    ...(release ? { installedRelease: release } : {}),
    message: "Update check requested",
    automaticUpdatesEnabled: true,
    releaseChannel: getControllerReleaseChannel(),
  };
  const target = paths();
  writeFileSync(target.statusPath, `${JSON.stringify(requested)}\n`, { mode: 0o644 });
  writeFileSync(target.requestPath, `${new Date().toISOString()}\n`, { mode: 0o644 });
}

export async function setControllerReleaseChannel(channel: ControllerReleaseChannel): Promise<void> {
  const target = paths();
  const temporaryPath = `${target.releaseChannelPath}.tmp`;
  writeFileSync(temporaryPath, `${channel}\n`, { mode: 0o644 });
  renameSync(temporaryPath, target.releaseChannelPath);
}
