import type { FeedCycleRuntimeState } from "@modreef/api-contract";
import type { Equipment } from "@modreef/digital-twin";

import type { EdgeFeedMode } from "./edgeClient";

export function feedCycleTargetControllerIds(
  equipment: Equipment[],
  controllerIds: Record<string, string>,
): string[] {
  return [...new Set(equipment.flatMap((item) => {
    const type = item.programType ?? item.role;
    const controllerId = controllerIds[item.id];
    return controllerId &&
        (type === "return-pump" || type === "skimmer")
      ? [controllerId]
      : [];
  }))];
}

export function reconcileFeedMode(
  current: EdgeFeedMode | null,
  reported: FeedCycleRuntimeState | undefined,
  now = Date.now(),
): EdgeFeedMode | null {
  if (reported) {
    // Recovery is now equipment-owned. Older controllers may briefly report
    // the legacy Feed Cycle recovery phase; it must not keep the panel active.
    if (reported.status === "recovery") return null;
    return {
      id: reported.id,
      intent: "feed-mode",
      startedAt: reported.startedAt,
      endsAt: reported.endsAt,
      durationSeconds: reported.durationSeconds,
      ...(reported.cycleId ? { cycleId: reported.cycleId } : {}),
      actions: [],
      phase: reported.status,
    };
  }

  if (!current) return null;
  if (current.phase === "recovery") return null;
  const transitionAt = Date.parse(current.endsAt);
  return Number.isFinite(transitionAt) && transitionAt <= now
    ? null
    : current;
}
