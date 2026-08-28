import type { GHomeWp12Credentials } from "./edge-credential-store.js";

const legacyRuntimeDeviceId = "ghome-wp12";

/**
 * Keeps the runtime identity stable when the same Tuya device is handed off
 * more than once. Older factory databases used `ghome-wp12` for the first
 * strip, so an idempotent retry must retain that alias rather than creating a
 * second physical device under the Tuya device id.
 */
export function ghomeRuntimeDeviceId(
  deviceId: string,
  stored: readonly GHomeWp12Credentials[],
): string {
  const ghome = stored.filter(({ deviceKind }) => deviceKind !== "yinmik-water");
  const existingIndex = ghome.findIndex((item) => item.deviceId === deviceId);
  if (existingIndex >= 0) {
    return ghome[existingIndex]!.runtimeDeviceId ??
      (existingIndex === 0 ? legacyRuntimeDeviceId : deviceId);
  }
  return ghome.length === 0 ? legacyRuntimeDeviceId : deviceId;
}

export function ghomeCredentialDeviceIdForRuntime(
  runtimeDeviceId: string,
  stored: readonly GHomeWp12Credentials[],
): string | undefined {
  const credential = stored.find(({ deviceId, deviceKind }) =>
    deviceKind !== "yinmik-water" &&
    ghomeRuntimeDeviceId(deviceId, stored) === runtimeDeviceId
  );
  return credential?.deviceId;
}
