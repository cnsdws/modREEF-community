import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface MdpAirLinkNetwork {
  interfaceName: string;
  ssid: string;
  bssid: string;
  localAddress: string;
}

export function parseIwInterfaces(output: string): string[] {
  return [...output.matchAll(/^\s*Interface\s+(\S+)\s*$/gm)].map((match) => match[1]!);
}

export function parseIwLink(output: string): { ssid: string; bssid: string } | undefined {
  const bssid = output.match(/^Connected to\s+([0-9a-f:]{17})\b/im)?.[1];
  const ssid = output.match(/^\s*SSID:\s*(.+?)\s*$/im)?.[1];
  return bssid && ssid ? { bssid: bssid.toLowerCase(), ssid } : undefined;
}

export function parseNmcliWifiDevice(output: string): string | undefined {
  return output.split("\n").map((line) => line.split(":")).find(
    ([, type, state]) => type === "wifi" && state?.startsWith("connected"),
  )?.[0];
}

export function parseNmcliActiveAccessPoint(
  output: string,
): { ssid: string; bssid: string } | undefined {
  const match = output.match(/^(?:\*|yes):(.+):((?:[0-9a-f]{2}\\:){5}[0-9a-f]{2})\s*$/im);
  return match?.[1] && match[2]
    ? { ssid: match[1].replaceAll("\\:", ":"), bssid: match[2].replaceAll("\\:", ":").toLowerCase() }
    : undefined;
}

export async function getMdpAirLinkNetwork(
  expectedSsid: string,
  run: typeof execFileAsync = execFileAsync,
): Promise<MdpAirLinkNetwork> {
  let interfaceNames: string[];
  try {
    interfaceNames = parseIwInterfaces((await run("iw", ["dev"])).stdout);
  } catch {
    try {
      const device = parseNmcliWifiDevice((await run("nmcli", [
        "-t", "-f", "DEVICE,TYPE,STATE", "device", "status",
      ])).stdout);
      if (device) {
        const link = parseNmcliActiveAccessPoint((await run("nmcli", [
          "-t", "-f", "IN-USE,SSID,BSSID", "device", "wifi", "list",
          "ifname", device, "--rescan", "no",
        ])).stdout);
        const localAddress = networkInterfaces()[device]?.find(
          (address) => address.family === "IPv4" && !address.internal,
        )?.address;
        if (link && localAddress && link.ssid === expectedSsid) {
          return { interfaceName: device, localAddress, ...link };
        }
      }
    } catch {
      // The common error below is more useful than exposing subprocess output.
    }
    throw new Error(`The Reef Controller must be connected to the 2.4 GHz Wi-Fi network “${expectedSsid}”`);
  }
  for (const interfaceName of interfaceNames) {
    const link = parseIwLink((await run("iw", ["dev", interfaceName, "link"])).stdout);
    if (!link || link.ssid !== expectedSsid) continue;
    const localAddress = networkInterfaces()[interfaceName]?.find(
      (address) => address.family === "IPv4" && !address.internal,
    )?.address;
    if (localAddress) return { interfaceName, localAddress, ...link };
  }
  throw new Error(`The Reef Controller must be connected to the 2.4 GHz Wi-Fi network “${expectedSsid}”`);
}
