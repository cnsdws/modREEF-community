export interface DiscoveredController {
  id: string;
  name: string;
  setupId: string;
  url: string;
  claimed: boolean;
}

export async function discoverReefControllers(
  _signal?: AbortSignal,
): Promise<DiscoveredController[]> {
  // Browsers cannot enumerate Bonjour services. The web app continues to
  // manage controllers after they have been claimed by a native app.
  return [];
}
