import { randomUUID } from "node:crypto";

import type {
  ActivityCategory,
  ActivityEvent,
  AquariumEventSource,
} from "@modreef/digital-twin";

export interface AquariumActivityInput {
  category: ActivityCategory;
  action: string;
  title: string;
  source: Extract<AquariumEventSource, "manual" | "automation">;
  details?: string;
  equipmentId?: string;
  alertId?: string;
}

export function createActivityEvent(
  aquariumId: string,
  input: AquariumActivityInput,
  now = new Date(),
): ActivityEvent {
  const timestamp = now.toISOString();

  return {
    id: randomUUID(),
    aquariumId,
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: input.source,
    type: "activity",
    category: input.category,
    action: input.action,
    title: input.title,
    ...(input.details ? { details: input.details } : {}),
    ...(input.equipmentId ? { equipmentId: input.equipmentId } : {}),
    ...(input.alertId ? { alertId: input.alertId } : {}),
  };
}
