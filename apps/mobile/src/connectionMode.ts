export type DashboardConnectionMode = "local" | "cloud";

export function dashboardConnectionMode(
  value = process.env.EXPO_PUBLIC_MODREEF_CONNECTION_MODE,
): DashboardConnectionMode {
  return value === "local" ? "local" : "cloud";
}
