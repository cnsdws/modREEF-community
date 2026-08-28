import * as SecureStore from "expo-secure-store";

const selectedTargetKey = "modreef.edge.selected-target";
const defaultEdgeUrl = "http://modreef.local:3000";

export interface EdgeTarget {
  edgeId: string;
  name: string;
  url: string;
}

let selectedTarget: EdgeTarget | null = null;

export function currentEdgeTarget(): EdgeTarget | null {
  return selectedTarget;
}

export function currentEdgeUrl(): string {
  return selectedTarget?.url ??
    process.env.EXPO_PUBLIC_MODREEF_EDGE_URL ??
    defaultEdgeUrl;
}

export async function selectEdgeTarget(target: EdgeTarget): Promise<void> {
  selectedTarget = target;
  if (await SecureStore.isAvailableAsync()) {
    await SecureStore.setItemAsync(selectedTargetKey, JSON.stringify(target));
  }
}

export async function restoreEdgeTarget(): Promise<EdgeTarget | null> {
  if (selectedTarget) return selectedTarget;
  if (!(await SecureStore.isAvailableAsync())) return null;
  const stored = await SecureStore.getItemAsync(selectedTargetKey);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as EdgeTarget;
    if (!parsed.edgeId || !parsed.name || !parsed.url) return null;
    selectedTarget = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function localUrlForHostname(hostname: string): string {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return `http://${hostname}:3000`;
  }
  const normalized = hostname.endsWith(".local") ? hostname : `${hostname}.local`;
  return `http://${normalized}:3000`;
}
