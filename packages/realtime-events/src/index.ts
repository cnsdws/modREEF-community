import type { CommandId, CommandStatus } from "@modreef/api-contract";
import type { Equipment } from "@modreef/digital-twin";

export interface RealtimeEventEnvelope<TType extends string, TData> {
  eventId: string;
  aquariumId: string;
  edgeId: string;
  sequence: number;
  occurredAt: string;
  type: TType;
  data: TData;
}

export type EdgeHeartbeatEvent = RealtimeEventEnvelope<
  "edge.heartbeat",
  {
    status: "online";
    version: string;
    uptimeSeconds: number;
  }
>;

export type EquipmentReportedEvent = RealtimeEventEnvelope<
  "equipment.reported",
  {
    equipment: Equipment;
    reportedAt: string;
  }
>;

export type CommandStatusEvent = RealtimeEventEnvelope<
  "command.status",
  {
    commandId: CommandId;
    status: CommandStatus;
    equipmentId?: string;
    message?: string;
  }
>;

export type ModReefRealtimeEvent =
  | EdgeHeartbeatEvent
  | EquipmentReportedEvent
  | CommandStatusEvent;
