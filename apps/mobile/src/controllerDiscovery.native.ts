import Zeroconf from "react-native-zeroconf";
import { NativeModules } from "react-native";

import type { DiscoveredController } from "./controllerDiscovery";

interface ZeroconfService {
  name?: string;
  host?: string;
  port?: number;
  addresses?: string[];
}

interface ControllerHealth {
  claimed?: boolean;
  hostname?: string;
  setupId?: string;
}

function safelyStopDiscovery(zeroconf: Zeroconf) {
  // react-native-zeroconf throws when stop() is called before its native
  // browser has been created (or after it has already been torn down). That
  // is a normal race when a scan is cancelled while the setup panel closes.
  try {
    zeroconf.stop();
  } catch {
    // Discovery is already stopped, so there is nothing left to clean up.
  }
}

function serviceUrl(service: ZeroconfService): string | null {
  const address = service.addresses?.find((value) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value));
  const host = address ?? service.host?.replace(/\.$/, "");
  return host && service.port ? `http://${host}:${service.port}` : null;
}

export async function discoverReefControllers(
  signal?: AbortSignal,
): Promise<DiscoveredController[]> {
  if (signal?.aborted) throw new Error("Controller discovery cancelled");
  if (!NativeModules.RNZeroconf) {
    throw new Error(
      "Local controller discovery is not installed in this app build. Reinstall the modREEF development app and try again.",
    );
  }

  const zeroconf = new Zeroconf();
  const services = new Map<string, ZeroconfService>();
  const resolved = (value: unknown) => {
    const service = value as ZeroconfService;
    if (service.name) services.set(service.name, service);
  };
  zeroconf.on("resolved", resolved);

  try {
    zeroconf.scan("modreef", "tcp", "local.");
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal?.removeEventListener("abort", cancel);
        resolve();
      };
      const timeout = setTimeout(finish, 5_000);
      const cancel = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        reject(new Error("Controller discovery cancelled"));
      };
      signal?.addEventListener("abort", cancel, { once: true });
    });
  } finally {
    safelyStopDiscovery(zeroconf);
    try {
      zeroconf.removeListener("resolved", resolved);
      zeroconf.removeDeviceListeners();
    } catch {
      // Native listener subscriptions may already be gone after cancellation.
    }
  }

  const candidates = await Promise.all([...services.values()].map(async (service) => {
    const url = serviceUrl(service);
    if (!url) return null;
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) return null;
      const health = await response.json() as ControllerHealth;
      const setupId = health.setupId?.trim() || "Nearby";
      return {
        id: `${health.hostname ?? service.name ?? url}-${setupId}`,
        name: "New Reef Controller",
        setupId,
        url,
        claimed: health.claimed === true,
      } satisfies DiscoveredController;
    } catch {
      return null;
    }
  }));

  return candidates
    .filter((candidate): candidate is DiscoveredController => candidate !== null)
    .sort((left, right) => left.setupId.localeCompare(right.setupId));
}
