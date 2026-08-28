export type Identifier = string;
export type IsoDateTime = string;

export type ExecutionLocation =
  | "device"
  | "vendor-cloud"
  | "app"
  | "optional-local-runtime";

export type ConnectionStatus =
  | "online"
  | "offline"
  | "unknown"
  | "degraded";

export type HealthStatus =
  | "normal"
  | "attention"
  | "warning"
  | "critical"
  | "unknown";

export interface Timestamped {
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}
