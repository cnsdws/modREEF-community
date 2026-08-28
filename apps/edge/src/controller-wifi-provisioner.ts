import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

import type { WifiCredentials } from "@modreef/onboarding";

export const controllerWifiConnectionPath =
  "/etc/NetworkManager/system-connections/modreef-onboarding.nmconnection";

function keyfileValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Wi-Fi credentials contain unsupported characters");
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;");
}

export function renderControllerWifiConnection(credentials: WifiCredentials): string {
  if (!credentials.ssid.trim() || credentials.ssid.length > 32 ||
      credentials.password.length < 8 || credentials.password.length > 63) {
    throw new Error("Invalid Wi-Fi credentials");
  }
  return [
    "[connection]",
    "id=modreef-onboarding",
    "type=wifi",
    "autoconnect=true",
    "",
    "[wifi]",
    "mode=infrastructure",
    `ssid=${keyfileValue(credentials.ssid)}`,
    "",
    "[wifi-security]",
    "key-mgmt=wpa-psk",
    `psk=${keyfileValue(credentials.password)}`,
    "",
    "[ipv4]",
    "method=auto",
    "",
    "[ipv6]",
    "method=auto",
    "",
  ].join("\n");
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => { errorOutput += value; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(errorOutput.trim() || `Network setup failed (${code ?? "unknown"})`)));
  });
}

export async function provisionControllerWifi(
  credentials: WifiCredentials,
  connectionPath = controllerWifiConnectionPath,
): Promise<void> {
  const temporaryPath = `${connectionPath}.tmp-${process.pid}`;
  await mkdir(dirname(connectionPath), { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, renderControllerWifiConnection(credentials), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, connectionPath);
  await run("nmcli", ["connection", "reload"]);
  await run("nmcli", ["--wait", "90", "connection", "up", "modreef-onboarding"]);
}
