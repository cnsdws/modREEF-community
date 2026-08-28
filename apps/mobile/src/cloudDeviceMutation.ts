import type { EdgeSummary } from "@modreef/api-contract";

export function edgeIsCurrentlyOnline(edge: EdgeSummary, now = Date.now()): boolean {
  const lastSeen = edge.lastSeenAt ? Date.parse(edge.lastSeenAt) : Number.NaN;
  return edge.status === "online" && Number.isFinite(lastSeen) &&
    now - lastSeen < 60_000;
}
