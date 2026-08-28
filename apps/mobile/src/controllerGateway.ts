export interface ControllerCommandRoute<T> {
  preferLocal: boolean;
  local?: () => Promise<T>;
  cloud: () => Promise<T>;
}

export async function executeControllerCommand<T>(
  route: ControllerCommandRoute<T>,
): Promise<T> {
  if (route.preferLocal && route.local) {
    try {
      return await route.local();
    } catch {
      // The controller command standard requires transparent cloud fallback.
    }
  }
  return route.cloud();
}
