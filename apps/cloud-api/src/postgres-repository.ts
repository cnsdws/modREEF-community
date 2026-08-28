import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  AquariumEvent, CloudCommandRequest, EdgeSyncRequest, WaterAlarmRules, WaterAlarmSettings,
} from "@modreef/api-contract";
import type { CloudRepository, Identity } from "./types.js";

const transientCommandTypes = [
  "automation.feed-cycle.start",
  "automation.feed-cycle.stop",
  "equipment.run-doser-calibration",
  "equipment.set-control-mode",
  "equipment.set-power",
  "equipment.set-speed",
  "equipment.set-wavemaker-configuration",
];

const postgresUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresCloudRepository implements CloudRepository {
  constructor(private readonly pool: Pool) {}

  async checkReadiness(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async userId(identity: Identity): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO users (auth_subject, email) VALUES ($1, $2)
       ON CONFLICT (auth_subject) DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
       RETURNING id`,
      [identity.subject, identity.email ?? null],
    );
    return result.rows[0]!.id;
  }

  private async access(
    identity: Identity,
    aquariumId: string,
    includeArchived = false,
  ): Promise<{ userId: string; role: "owner" | "admin" | "viewer" | null }> {
    // Aquarium primary keys are PostgreSQL UUIDs. Reject malformed route
    // parameters before they reach a typed query so a stale client identifier
    // becomes a normal not-found response instead of a database error.
    if (!postgresUuidPattern.test(aquariumId)) {
      return { userId: "", role: null };
    }
    const userId = await this.userId(identity);
    const result = await this.pool.query<{ role: "owner" | "admin" | "viewer" }>(
      `SELECT membership.role
       FROM aquarium_memberships membership
       JOIN aquariums aquarium ON aquarium.id = membership.aquarium_id
       WHERE membership.user_id = $1 AND membership.aquarium_id = $2
         AND ($3::boolean OR aquarium.archived_at IS NULL)`,
      [userId, aquariumId, includeArchived],
    );
    return { userId, role: result.rows[0]?.role ?? null };
  }

  async listAquariums(identity: Identity) {
    const userId = await this.userId(identity);
    const result = await this.pool.query(
      `SELECT a.id, a.name, m.role, a.created_at AS "createdAt"
       FROM aquariums a JOIN aquarium_memberships m ON m.aquarium_id = a.id
       WHERE m.user_id = $1 AND a.archived_at IS NULL ORDER BY a.created_at`, [userId]);
    return result.rows;
  }

  async listArchivedAquariums(identity: Identity) {
    const userId = await this.userId(identity);
    const result = await this.pool.query(
      `SELECT a.id, a.name, m.role, a.created_at AS "createdAt",
              a.archived_at AS "archivedAt"
       FROM aquariums a JOIN aquarium_memberships m ON m.aquarium_id = a.id
       WHERE m.user_id = $1 AND a.archived_at IS NOT NULL
       ORDER BY a.archived_at DESC`, [userId]);
    return result.rows;
  }

  async createAquarium(identity: Identity, name: string) {
    const userId = await this.userId(identity);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const aquarium = await client.query<{ id: string; name: string; createdAt: string }>(
        `INSERT INTO aquariums (name) VALUES ($1)
         RETURNING id, name, created_at AS "createdAt"`, [name]);
      await client.query(
        `INSERT INTO aquarium_memberships (aquarium_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [aquarium.rows[0]!.id, userId],
      );
      await client.query("COMMIT");
      return { ...aquarium.rows[0]!, role: "owner" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAquarium(identity: Identity, aquariumId: string) {
    const userId = await this.userId(identity);
    const result = await this.pool.query(
      `SELECT a.id, a.name, m.role, a.created_at AS "createdAt"
       FROM aquariums a JOIN aquarium_memberships m ON m.aquarium_id = a.id
       WHERE m.user_id = $1 AND a.id = $2 AND a.archived_at IS NULL`, [userId, aquariumId]);
    return result.rows[0] ?? null;
  }

  async renameAquarium(identity: Identity, aquariumId: string, name: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const result = await this.pool.query(
      `UPDATE aquariums SET name = $2
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, name, created_at AS "createdAt"`,
      [aquariumId, name],
    );
    const aquarium = result.rows[0];
    return aquarium ? { ...aquarium, role: access.role } : null;
  }

  async archiveAquarium(identity: Identity, aquariumId: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const aquarium = await client.query(
        `SELECT id FROM aquariums
         WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
        [aquariumId],
      );
      if (aquarium.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      const controllers = await client.query<{ id: string }>(
        `SELECT id FROM edges
         WHERE aquarium_id = $1 AND retired_at IS NULL ORDER BY id`,
        [aquariumId],
      );
      if (controllers.rowCount) {
        await client.query("ROLLBACK");
        return {
          status: "blocked" as const,
          controllerIds: controllers.rows.map(({ id }) => id),
        };
      }
      const archived = await client.query(
        `UPDATE aquariums SET archived_at = now()
         WHERE id = $1
         RETURNING id, name, created_at AS "createdAt", archived_at AS "archivedAt"`,
        [aquariumId],
      );
      await client.query("COMMIT");
      return {
        status: "archived" as const,
        aquarium: { ...archived.rows[0]!, role: access.role },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreAquarium(identity: Identity, aquariumId: string) {
    const access = await this.access(identity, aquariumId, true);
    if (!access.role || access.role === "viewer") return null;
    const result = await this.pool.query(
      `UPDATE aquariums SET archived_at = NULL
       WHERE id = $1 AND archived_at IS NOT NULL
       RETURNING id, name, created_at AS "createdAt", archived_at AS "archivedAt"`,
      [aquariumId],
    );
    return result.rows[0] ? { ...result.rows[0], role: access.role } : null;
  }

  async listEdges(identity: Identity, aquariumId: string) {
    if (!(await this.access(identity, aquariumId)).role) return null;
    const result = await this.pool.query(
      `SELECT id, aquarium_id AS "aquariumId", name, status, software_version AS "softwareVersion",
              last_seen_at AS "lastSeenAt", local_hostname AS "localHostname",
              local_address AS "localAddress",
              runtime_state AS "runtimeState"
       FROM edges WHERE aquarium_id = $1 AND retired_at IS NULL ORDER BY name`, [aquariumId]);
    return result.rows;
  }

  async renameEdge(identity: Identity, aquariumId: string, edgeId: string, name: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const result = await this.pool.query(
      `UPDATE edges SET name = $3
       WHERE id = $1 AND aquarium_id = $2 AND retired_at IS NULL
       RETURNING id, aquarium_id AS "aquariumId", name, status,
                 software_version AS "softwareVersion", last_seen_at AS "lastSeenAt",
                 local_hostname AS "localHostname", local_address AS "localAddress",
                 runtime_state AS "runtimeState"`,
      [edgeId, aquariumId, name],
    );
    return result.rows[0] ?? null;
  }

  async retireEdge(identity: Identity, aquariumId: string, edgeId: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const blockers = await this.pool.query<{
      equipmentId: string | null;
      deviceId: string | null;
    }>(
      `SELECT NULL::text AS "equipmentId", device_id AS "deviceId"
       FROM device_snapshots
       WHERE aquarium_id = $1 AND edge_id = $2
       UNION ALL
       SELECT equipment_id AS "equipmentId",
              COALESCE(document->>'physicalDeviceId', document#>>'{binding,deviceId}') AS "deviceId"
       FROM equipment_snapshots
       WHERE aquarium_id = $1 AND edge_id = $2
       ORDER BY "equipmentId" NULLS FIRST`,
      [aquariumId, edgeId],
    );
    if (blockers.rowCount) {
      return {
        status: "blocked" as const,
        deviceIds: [...new Set(blockers.rows.flatMap(({ deviceId }) => deviceId ? [deviceId] : []))],
        equipmentIds: blockers.rows.flatMap(({ equipmentId }) => equipmentId ? [equipmentId] : []),
      };
    }
    const result = await this.pool.query(
      `WITH retired AS (
         UPDATE edges
         SET device_token_hash = NULL, status = 'offline', retired_at = now()
         WHERE id = $1 AND aquarium_id = $2 AND retired_at IS NULL
         RETURNING id
       ), failed_commands AS (
         UPDATE cloud_commands
         SET status = 'failed',
             result = jsonb_build_object('message', 'Reef Controller removed from aquarium'),
             updated_at = now()
         WHERE edge_id IN (SELECT id FROM retired)
           AND status IN ('queued', 'delivered')
       )
       SELECT id FROM retired`,
      [edgeId, aquariumId],
    );
    return result.rowCount === 1 ? { status: "retired" as const } : null;
  }

  async reprovisionEdge(identity: Identity, aquariumId: string, edgeId: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await this.pool.query<{ id: string }>(
      `UPDATE edges SET device_token_hash = $3, status = 'provisioning'
       WHERE id = $1 AND aquarium_id = $2 AND retired_at IS NULL RETURNING id`,
      [edgeId, aquariumId, tokenHash],
    );
    return result.rowCount === 1
      ? { edgeId, aquariumId, token }
      : null;
  }

  async createLocalAuthorization(identity: Identity, aquariumId: string, edgeId: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const result = await this.pool.query<{ deviceTokenHash: string }>(
      `SELECT device_token_hash AS "deviceTokenHash" FROM edges
       WHERE id = $1 AND aquarium_id = $2 AND retired_at IS NULL
         AND device_token_hash IS NOT NULL`,
      [edgeId, aquariumId],
    );
    const deviceTokenHash = result.rows[0]?.deviceTokenHash;
    if (!deviceTokenHash) return null;
    const expiresAtMs = Date.now() + 60_000;
    const payload = Buffer.from(JSON.stringify({
      edgeId,
      aquariumId,
      expiresAtMs,
      nonce: randomUUID(),
    })).toString("base64url");
    const signature = createHmac("sha256", deviceTokenHash)
      .update(payload)
      .digest("base64url");
    return {
      grant: `${payload}.${signature}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async listEquipment(identity: Identity, aquariumId: string) {
    if (!(await this.access(identity, aquariumId)).role) return null;
    const result = await this.pool.query(
      `SELECT equipment_id AS "equipmentId", edge_id AS "edgeId", document, reported_at AS "reportedAt"
       FROM equipment_snapshots WHERE aquarium_id = $1 ORDER BY equipment_id`, [aquariumId]);
    return result.rows;
  }

  async listDevices(identity: Identity, aquariumId: string) {
    if (!(await this.access(identity, aquariumId)).role) return null;
    const result = await this.pool.query(
      `SELECT device_id AS "deviceId", edge_id AS "edgeId", document, reported_at AS "reportedAt"
       FROM device_snapshots WHERE aquarium_id = $1 ORDER BY device_id`, [aquariumId]);
    return result.rows;
  }

  async listEvents(identity: Identity, aquariumId: string, limit: number) {
    if (!(await this.access(identity, aquariumId)).role) return null;
    const result = await this.pool.query<AquariumEvent>(
      `SELECT event_id AS "eventId", aquarium_id AS "aquariumId", edge_id AS "edgeId", sequence,
              type, occurred_at AS "occurredAt", document
       FROM aquarium_events WHERE aquarium_id = $1 ORDER BY occurred_at DESC LIMIT $2`, [aquariumId, limit]);
    return result.rows;
  }

  async getWaterAlarmSettings(identity: Identity, aquariumId: string) {
    if (!(await this.access(identity, aquariumId)).role) return null;
    const result = await this.pool.query<WaterAlarmSettings>(
      `SELECT aquarium_id AS "aquariumId", rules, revision::int AS revision, updated_at AS "updatedAt"
       FROM water_alarm_settings WHERE aquarium_id = $1`,
      [aquariumId],
    );
    return result.rows[0];
  }

  async saveWaterAlarmSettings(identity: Identity, aquariumId: string, rules: WaterAlarmRules) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const result = await this.pool.query<WaterAlarmSettings>(
      `INSERT INTO water_alarm_settings (aquarium_id, rules)
       VALUES ($1, $2)
       ON CONFLICT (aquarium_id) DO UPDATE SET
         rules = EXCLUDED.rules,
         revision = water_alarm_settings.revision + 1,
         updated_at = now()
       RETURNING aquarium_id AS "aquariumId", rules, revision::int AS revision, updated_at AS "updatedAt"`,
      [aquariumId, JSON.stringify(rules)],
    );
    return result.rows[0] ?? null;
  }

  async createCommand(identity: Identity, aquariumId: string, request: CloudCommandRequest) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const edge = await this.pool.query(
      `SELECT 1 FROM edges WHERE id = $1 AND aquarium_id = $2`,
      [request.edgeId, aquariumId],
    );
    if (edge.rowCount !== 1) return null;
    if (request.type.startsWith("equipment.")) {
      const equipment = await this.pool.query(
        `SELECT 1 FROM equipment_snapshots
         WHERE aquarium_id = $1 AND edge_id = $2 AND equipment_id = $3`,
        [aquariumId, request.edgeId, request.equipmentId],
      );
      if (equipment.rowCount !== 1) return null;
      const relatedEquipmentId = request.type === "equipment.clone-configuration"
        ? request.payload.destinationEquipmentId
        : request.type === "equipment.swap-binding"
          ? request.payload.otherEquipmentId
          : undefined;
      if (relatedEquipmentId !== undefined) {
        if (typeof relatedEquipmentId !== "string" || relatedEquipmentId.length === 0) {
          return null;
        }
        const related = await this.pool.query(
          `SELECT 1 FROM equipment_snapshots
           WHERE aquarium_id = $1 AND edge_id = $2 AND equipment_id = $3`,
          [aquariumId, request.edgeId, relatedEquipmentId],
        );
        if (related.rowCount !== 1) return null;
      }
      if (request.type === "equipment.update-layout") {
        const settings = request.payload.settings;
        if (!Array.isArray(settings) || settings.length === 0 ||
            settings.some((setting) => typeof setting !== "object" || setting === null ||
              typeof (setting as Record<string, unknown>).equipmentId !== "string")) {
          return null;
        }
        const equipmentIds = settings.map((setting) =>
          (setting as { equipmentId: string }).equipmentId
        );
        if (new Set(equipmentIds).size !== equipmentIds.length) return null;
        const related = await this.pool.query(
          `SELECT equipment_id FROM equipment_snapshots
           WHERE aquarium_id = $1 AND edge_id = $2 AND equipment_id = ANY($3::text[])`,
          [aquariumId, request.edgeId, equipmentIds],
        );
        if (related.rowCount !== equipmentIds.length) return null;
      }
    }
    if (request.type.startsWith("managed-device.")) {
      const deviceId = typeof request.payload.deviceId === "string"
        ? request.payload.deviceId
        : request.equipmentId;
      const device = await this.pool.query(
        `SELECT 1 FROM device_snapshots
         WHERE aquarium_id = $1 AND edge_id = $2 AND device_id = $3
         UNION ALL
         SELECT 1 FROM equipment_snapshots
         WHERE aquarium_id = $1 AND edge_id = $2
           AND COALESCE(document->>'physicalDeviceId', document#>>'{binding,deviceId}') = $3
         LIMIT 1`,
        [aquariumId, request.edgeId, deviceId],
      );
      if (device.rowCount !== 1) return null;
    }
    const result = await this.pool.query(
      `INSERT INTO cloud_commands
         (command_id, aquarium_id, edge_id, requested_by, type, equipment_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (command_id) DO NOTHING
       RETURNING command_id AS "commandId", aquarium_id AS "aquariumId", edge_id AS "edgeId",
                 type, equipment_id AS "equipmentId", payload, status, created_at AS "createdAt"`,
      [request.commandId, aquariumId, request.edgeId, access.userId, request.type,
       request.equipmentId, JSON.stringify(request.payload)],
    );
    if (result.rows[0]) return result.rows[0];
    const replay = await this.pool.query(
      `SELECT command_id AS "commandId", aquarium_id AS "aquariumId", edge_id AS "edgeId",
              type, equipment_id AS "equipmentId", payload, status, created_at AS "createdAt"
       FROM cloud_commands
       WHERE command_id = $1 AND aquarium_id = $2 AND edge_id = $3
         AND type = $4 AND equipment_id = $5 AND payload = $6::jsonb`,
      [request.commandId, aquariumId, request.edgeId, request.type,
       request.equipmentId, JSON.stringify(request.payload)],
    );
    return replay.rows[0] ?? null;
  }

  async getCommand(identity: Identity, aquariumId: string, commandId: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role) return null;
    const result = await this.pool.query(
      `SELECT command_id AS "commandId", aquarium_id AS "aquariumId", edge_id AS "edgeId",
              type, equipment_id AS "equipmentId", payload, status,
              created_at AS "createdAt", result->>'message' AS message
       FROM cloud_commands
       WHERE aquarium_id = $1 AND command_id = $2`,
      [aquariumId, commandId],
    );
    return result.rows[0] ?? null;
  }

  async registerEdge(identity: Identity, aquariumId: string, name: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role || access.role === "viewer") return null;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO edges (aquarium_id, name, device_token_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [aquariumId, name, tokenHash],
    );
    return { edgeId: result.rows[0]!.id, aquariumId, token };
  }

  async synchronizeEdge(token: string, request: EdgeSyncRequest) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const authenticated = await client.query(
        `SELECT 1 FROM edges WHERE id = $1 AND aquarium_id = $2 AND device_token_hash = $3 FOR UPDATE`,
        [request.edgeId, request.aquariumId, tokenHash],
      );
      if (authenticated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `UPDATE edges SET status = 'online', software_version = $2,
           local_hostname = COALESCE($3, local_hostname),
           local_address = COALESCE($4, local_address),
           runtime_state = COALESCE($5::jsonb, runtime_state), last_seen_at = now()
         WHERE id = $1`,
        [request.edgeId, request.softwareVersion, request.localHostname ?? null,
         request.localAddress ?? null,
         request.runtimeState ? JSON.stringify(request.runtimeState) : null],
      );
      const authoritativeEquipment = request.equipment.filter(
        (snapshot) => snapshot.edgeId === request.edgeId,
      );
      if (request.devices) {
        const authoritativeDevices = request.devices.filter(
          (snapshot) => snapshot.edgeId === request.edgeId,
        );
        await client.query(
          `DELETE FROM device_snapshots
           WHERE aquarium_id = $1 AND edge_id = $2
             AND NOT (device_id = ANY($3::text[]))`,
          [request.aquariumId, request.edgeId,
           authoritativeDevices.map((snapshot) => snapshot.deviceId)],
        );
        for (const snapshot of authoritativeDevices) {
          await client.query(
            `INSERT INTO device_snapshots (aquarium_id, edge_id, device_id, document, reported_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (aquarium_id, device_id) DO UPDATE SET
               edge_id = EXCLUDED.edge_id, document = EXCLUDED.document,
               reported_at = EXCLUDED.reported_at`,
            [request.aquariumId, request.edgeId, snapshot.deviceId,
             JSON.stringify(snapshot.document), snapshot.reportedAt],
          );
        }
      }
      await client.query(
        `DELETE FROM equipment_snapshots
         WHERE aquarium_id = $1 AND edge_id = $2
           AND NOT (equipment_id = ANY($3::text[]))`,
        [
          request.aquariumId,
          request.edgeId,
          authoritativeEquipment.map((snapshot) => snapshot.equipmentId),
        ],
      );
      for (const snapshot of authoritativeEquipment) {
        await client.query(
          `INSERT INTO equipment_snapshots (aquarium_id, edge_id, equipment_id, document, reported_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (aquarium_id, equipment_id) DO UPDATE SET
             edge_id = EXCLUDED.edge_id, document = EXCLUDED.document, reported_at = EXCLUDED.reported_at`,
          [request.aquariumId, request.edgeId, snapshot.equipmentId,
           JSON.stringify(snapshot.document), snapshot.reportedAt],
        );
      }
      for (const event of request.events) {
        await client.query(
          `INSERT INTO aquarium_events (event_id, aquarium_id, edge_id, sequence, type, occurred_at, document)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (event_id) DO UPDATE SET
             type = EXCLUDED.type, occurred_at = EXCLUDED.occurred_at,
             document = EXCLUDED.document`,
          [event.eventId, request.aquariumId, request.edgeId, event.sequence,
           event.type, event.occurredAt, JSON.stringify(event.document)],
        );
      }
      const acceptedCommandIds: string[] = [];
      for (const result of request.commandResults) {
        const updated = await client.query<{ command_id: string; type: string; payload: Record<string, unknown> }>(
          `UPDATE cloud_commands SET status = $3, result = $4, updated_at = now()
           WHERE command_id = $1 AND edge_id = $2 AND status IN ('queued', 'delivered')
           RETURNING command_id, type, payload`,
          [result.commandId, request.edgeId, result.status, JSON.stringify({ message: result.message })],
        );
        const completed = updated.rows[0];
        if (completed) {
          acceptedCommandIds.push(completed.command_id);
          if (result.status === "completed" && completed.type === "aquarium.event.delete" &&
              typeof completed.payload.eventId === "string") {
            await client.query(
              `DELETE FROM aquarium_events WHERE aquarium_id = $1 AND event_id = $2`,
              [request.aquariumId, completed.payload.eventId],
            );
          }
        }
      }
      await client.query(
        `UPDATE cloud_commands
         SET status = 'failed',
             result = jsonb_build_object('message', 'Operational command expired before delivery'),
             updated_at = now()
         WHERE edge_id = $1 AND status IN ('queued', 'delivered')
           AND type = ANY($2::text[])
           AND created_at < now() - interval '2 minutes'`,
        [request.edgeId, transientCommandTypes],
      );
      await client.query(
        `WITH ranked AS (
           SELECT command_id,
                  row_number() OVER (
                    PARTITION BY equipment_id,
                      CASE
                        WHEN type IN ('equipment.set-power', 'equipment.set-control-mode')
                          THEN 'equipment-control'
                        WHEN type IN ('automation.feed-cycle.start', 'automation.feed-cycle.stop')
                          THEN 'feed-cycle'
                        ELSE type
                      END
                    ORDER BY created_at DESC, command_id DESC
                  ) AS position
           FROM cloud_commands
           WHERE edge_id = $1 AND status IN ('queued', 'delivered')
             AND type = ANY($2::text[])
         )
         UPDATE cloud_commands AS command
         SET status = 'failed',
             result = jsonb_build_object('message', 'Operational command superseded by a newer request'),
             updated_at = now()
         FROM ranked
         WHERE command.command_id = ranked.command_id AND ranked.position > 1`,
        [request.edgeId, transientCommandTypes],
      );
      const commands = await client.query(
        `UPDATE cloud_commands SET status = 'delivered', updated_at = now()
         WHERE command_id IN (
           SELECT command_id FROM cloud_commands
           WHERE edge_id = $1 AND status IN ('queued', 'delivered')
           ORDER BY
             CASE
               WHEN type = ANY($2::text[]) THEN 0
               WHEN type LIKE 'aquarium.event.%' THEN 2
               ELSE 1
             END,
             CASE WHEN type = ANY($2::text[]) THEN created_at END DESC,
             created_at ASC
           LIMIT 50
         )
         RETURNING command_id AS "commandId", aquarium_id AS "aquariumId", edge_id AS "edgeId",
                   type, equipment_id AS "equipmentId", payload, status, created_at AS "createdAt"`,
        [request.edgeId, transientCommandTypes],
      );
      const waterAlarmSettings = await client.query<WaterAlarmSettings>(
        `SELECT aquarium_id AS "aquariumId", rules, revision::int AS revision, updated_at AS "updatedAt"
         FROM water_alarm_settings WHERE aquarium_id = $1`,
        [request.aquariumId],
      );
      await client.query("COMMIT");
      return {
        acceptedThroughSequence: request.events.reduce((max, event) => Math.max(max, event.sequence), 0),
        acceptedCommandIds,
        commands: commands.rows,
        serverTime: new Date().toISOString(),
        ...(waterAlarmSettings.rows[0]
          ? { waterAlarmSettings: waterAlarmSettings.rows[0] }
          : {}),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
