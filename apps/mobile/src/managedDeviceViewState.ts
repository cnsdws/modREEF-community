export type ManagedDeviceViewState =
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "empty"; message: string }
  | { kind: "ready" };

function isAuthorizationError(error: string): boolean {
  const normalized = error.toLowerCase();
  return normalized.includes("authorization") ||
    normalized.includes("unauthorized");
}

export function managedDeviceViewState(
  loading: boolean,
  error: string | null,
  deviceCount: number,
  cloudMode: boolean,
): ManagedDeviceViewState {
  if (loading) {
    return {
      kind: "loading",
      message: "Loading devices from Reef Controller…",
    };
  }

  if (error) {
    if (cloudMode && isAuthorizationError(error)) {
      return {
        kind: "error",
        message:
          "Devices remain available through cloud control. Local device administration is unavailable on this device.",
      };
    }

    return {
      kind: "error",
      message: cloudMode
        ? "Devices remain available through cloud control. The Reef Controller could not be reached for local administration."
        : "The Reef Controller could not load its connected devices.",
    };
  }

  if (deviceCount === 0) {
    return {
      kind: "empty",
      message: "No devices have been added to this Reef Controller.",
    };
  }

  return { kind: "ready" };
}
