import type {
  AquariumSummary,
  CreateAquariumRequest,
  RegisterEdgeRequest,
  RegisteredEdgeCredentials,
  CloudCommand,
  CloudCommandRequest,
  CloudEquipmentSnapshot,
  CloudDeviceSnapshot,
  EdgeSummary,
  AquariumEvent,
  ReefCoachReport,
  WaterAlarmRules,
  WaterAlarmSettings,
} from "@modreef/api-contract";

export interface ModReefRequest<TBody = undefined> {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: TBody;
}

export interface ModReefTransport {
  request<TResponse, TBody = undefined>(
    request: ModReefRequest<TBody>,
  ): Promise<TResponse>;
}

async function withinDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`modREEF Cloud request timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ModReefCloudClient {
  constructor(private readonly transport: ModReefTransport) {}

  async listAquariums(): Promise<AquariumSummary[]> {
    const response = await this.transport.request<{ aquariums: AquariumSummary[] }>({
      method: "GET",
      path: "/v1/aquariums",
    });
    return response.aquariums;
  }

  async listArchivedAquariums(): Promise<AquariumSummary[]> {
    const response = await this.transport.request<{ aquariums: AquariumSummary[] }>({
      method: "GET",
      path: "/v1/aquariums/archived",
    });
    return response.aquariums;
  }

  async createAquarium(name: string): Promise<AquariumSummary> {
    const response = await this.transport.request<
      { aquarium: AquariumSummary },
      CreateAquariumRequest
    >({ method: "POST", path: "/v1/aquariums", body: { name } });
    return response.aquarium;
  }

  async renameAquarium(aquariumId: string, name: string): Promise<AquariumSummary> {
    const response = await this.transport.request<
      { aquarium: AquariumSummary },
      { name: string }
    >({
      method: "PATCH",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}`,
      body: { name },
    });
    return response.aquarium;
  }

  async archiveAquarium(aquariumId: string): Promise<AquariumSummary> {
    const response = await this.transport.request<{ aquarium: AquariumSummary }>({
      method: "POST",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/archive`,
    });
    return response.aquarium;
  }

  async restoreAquarium(aquariumId: string): Promise<AquariumSummary> {
    const response = await this.transport.request<{ aquarium: AquariumSummary }>({
      method: "POST",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/restore`,
    });
    return response.aquarium;
  }

  async registerEdge(aquariumId: string, name: string): Promise<RegisteredEdgeCredentials> {
    const response = await this.transport.request<
      { credentials: RegisteredEdgeCredentials },
      RegisterEdgeRequest
    >({
      method: "POST",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/edges`,
      body: { name },
    });
    return response.credentials;
  }

  async listEdges(aquariumId: string): Promise<EdgeSummary[]> {
    const response = await this.transport.request<{ edges: EdgeSummary[] }>({
      method: "GET", path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/edges`,
    });
    return response.edges;
  }

  async renameEdge(aquariumId: string, edgeId: string, name: string): Promise<EdgeSummary> {
    const response = await this.transport.request<{ edge: EdgeSummary }, { name: string }>({
      method: "PATCH",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/edges/${encodeURIComponent(edgeId)}`,
      body: { name },
    });
    return response.edge;
  }

  async removeEdge(aquariumId: string, edgeId: string): Promise<void> {
    await this.transport.request<{ deleted: true }>({
      method: "DELETE",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/edges/${encodeURIComponent(edgeId)}`,
    });
  }

  async reprovisionEdge(aquariumId: string, edgeId: string): Promise<RegisteredEdgeCredentials> {
    const response = await this.transport.request<{ credentials: RegisteredEdgeCredentials }>({
      method: "POST",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/edges/${encodeURIComponent(edgeId)}/reprovision`,
    });
    return response.credentials;
  }

  async createLocalAuthorization(
    aquariumId: string,
    edgeId: string,
  ): Promise<{ grant: string; expiresAt: string }> {
    const response = await this.transport.request<{
      authorization: { grant: string; expiresAt: string };
    }>({
      method: "POST",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/edges/${encodeURIComponent(edgeId)}/local-authorization`,
    });
    return response.authorization;
  }

  async listEquipment(aquariumId: string): Promise<CloudEquipmentSnapshot[]> {
    const response = await this.transport.request<{ equipment: CloudEquipmentSnapshot[] }>({
      method: "GET", path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/equipment`,
    });
    return response.equipment;
  }

  async listDevices(aquariumId: string): Promise<CloudDeviceSnapshot[]> {
    const response = await this.transport.request<{ devices: CloudDeviceSnapshot[] }>({
      method: "GET", path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/devices`,
    });
    return response.devices;
  }

  async listEvents(aquariumId: string): Promise<AquariumEvent[]> {
    const response = await this.transport.request<{ events: AquariumEvent[] }>({
      method: "GET", path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/events`,
    });
    return response.events;
  }

  async getReefCoachReport(aquariumId: string): Promise<ReefCoachReport> {
    const response = await this.transport.request<{ report: ReefCoachReport }>({
      method: "GET",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/coach`,
    });
    return response.report;
  }

  async analyzeReefCoach(aquariumId: string): Promise<ReefCoachReport> {
    const response = await this.transport.request<{ report: ReefCoachReport }>({
      method: "POST",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/coach/analyze`,
    });
    return response.report;
  }

  async getWaterAlarmSettings(aquariumId: string): Promise<WaterAlarmSettings | null> {
    const response = await this.transport.request<{ settings: WaterAlarmSettings | null }>({
      method: "GET",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/water-alarm-settings`,
    });
    return response.settings;
  }

  async saveWaterAlarmSettings(
    aquariumId: string,
    rules: WaterAlarmRules,
  ): Promise<WaterAlarmSettings> {
    const response = await this.transport.request<
      { settings: WaterAlarmSettings }, { rules: WaterAlarmRules }
    >({
      method: "PUT",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/water-alarm-settings`,
      body: { rules },
    });
    return response.settings;
  }

  async createCommand(aquariumId: string, command: CloudCommandRequest): Promise<CloudCommand> {
    const response = await this.transport.request<
      { command: CloudCommand }, CloudCommandRequest
    >({ method: "POST", path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/commands`, body: command });
    return response.command;
  }

  async getCommand(aquariumId: string, commandId: string): Promise<CloudCommand> {
    const response = await this.transport.request<{ command: CloudCommand }>({
      method: "GET",
      path: `/v1/aquariums/${encodeURIComponent(aquariumId)}/commands/${encodeURIComponent(commandId)}`,
    });
    return response.command;
  }
}

export class ModReefHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ModReefHttpError";
  }
}

export class FetchModReefTransport implements ModReefTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: () => Promise<string | null>,
    private readonly requestTimeoutMs = 10_000,
  ) {}

  async request<TResponse, TBody = undefined>(request: ModReefRequest<TBody>): Promise<TResponse> {
    const token = await this.accessToken();
    if (!token) throw new ModReefHttpError(401, "Sign in to use modREEF Cloud");
    const response = await withinDeadline(
      fetch(`${this.baseUrl.replace(/\/$/, "")}${request.path}`, {
        method: request.method,
        ...(request.method === "GET" ? { cache: "no-store" as const } : {}),
        headers: {
          authorization: `Bearer ${token}`,
          ...(request.body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      }),
      this.requestTimeoutMs,
    );
    if (!response.ok) {
      let message = `modREEF Cloud request failed: ${response.status}`;
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string") message = body.error;
      } catch { /* Preserve the status message. */ }
      throw new ModReefHttpError(response.status, message);
    }
    return await response.json() as TResponse;
  }
}
