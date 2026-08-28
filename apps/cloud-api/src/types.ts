import type {
  AquariumEvent,
  AquariumSummary,
  CloudCommand,
  CloudCommandRequest,
  CloudEquipmentSnapshot,
  CloudDeviceSnapshot,
  EdgeSummary,
  EdgeSyncRequest,
  EdgeSyncResponse,
  RegisteredEdgeCredentials,
  WaterAlarmRules,
  WaterAlarmSettings,
} from "@modreef/api-contract";

export interface Identity {
  subject: string;
  email?: string;
}

export interface Authenticator {
  authenticate(authorization: string | undefined): Promise<Identity | null>;
}

export interface CloudRepository {
  checkReadiness(): Promise<void>;
  listAquariums(identity: Identity): Promise<AquariumSummary[]>;
  listArchivedAquariums(identity: Identity): Promise<AquariumSummary[]>;
  createAquarium(identity: Identity, name: string): Promise<AquariumSummary>;
  getAquarium(identity: Identity, aquariumId: string): Promise<AquariumSummary | null>;
  renameAquarium(identity: Identity, aquariumId: string, name: string): Promise<AquariumSummary | null>;
  archiveAquarium(identity: Identity, aquariumId: string): Promise<
    | { status: "archived"; aquarium: AquariumSummary }
    | { status: "blocked"; controllerIds: string[] }
    | null
  >;
  restoreAquarium(identity: Identity, aquariumId: string): Promise<AquariumSummary | null>;
  listEdges(identity: Identity, aquariumId: string): Promise<EdgeSummary[] | null>;
  renameEdge(identity: Identity, aquariumId: string, edgeId: string, name: string): Promise<EdgeSummary | null>;
  retireEdge(identity: Identity, aquariumId: string, edgeId: string): Promise<
    | { status: "retired" }
    | { status: "blocked"; deviceIds: string[]; equipmentIds: string[] }
    | null
  >;
  reprovisionEdge(identity: Identity, aquariumId: string, edgeId: string): Promise<RegisteredEdgeCredentials | null>;
  createLocalAuthorization(identity: Identity, aquariumId: string, edgeId: string): Promise<{ grant: string; expiresAt: string } | null>;
  listEquipment(identity: Identity, aquariumId: string): Promise<CloudEquipmentSnapshot[] | null>;
  listDevices(identity: Identity, aquariumId: string): Promise<CloudDeviceSnapshot[] | null>;
  listEvents(identity: Identity, aquariumId: string, limit: number): Promise<AquariumEvent[] | null>;
  getWaterAlarmSettings(identity: Identity, aquariumId: string): Promise<WaterAlarmSettings | null | undefined>;
  saveWaterAlarmSettings(identity: Identity, aquariumId: string, rules: WaterAlarmRules): Promise<WaterAlarmSettings | null>;
  createCommand(identity: Identity, aquariumId: string, request: CloudCommandRequest): Promise<CloudCommand | null>;
  getCommand(identity: Identity, aquariumId: string, commandId: string): Promise<CloudCommand | null>;
  registerEdge(identity: Identity, aquariumId: string, name: string): Promise<RegisteredEdgeCredentials | null>;
  synchronizeEdge(token: string, request: EdgeSyncRequest): Promise<EdgeSyncResponse | null>;
}

export interface AppRequest {
  method: string;
  path: string;
  authorization?: string;
  body?: unknown;
}

export interface AppResponse {
  status: number;
  body: unknown;
}
