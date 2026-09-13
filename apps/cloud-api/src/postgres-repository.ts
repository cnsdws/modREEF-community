import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  AquariumEvent, AquariumRole, CloudCommandRequest, EdgeSyncRequest, WaterAlarmRules, WaterAlarmSettings,
} from "@modreef/api-contract";
import type { CloudRepository, Identity } from "./types.js";
import {
  hasAquariumRole, requiredRoleForCommand, transientCommandTypes,
} from "./authorization.js";

const postgresUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export class PostgresCloudRepository implements CloudRepository {
  constructor(private readonly pool: Pool) {}

  async checkReadiness(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async userId(identity: Identity): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (auth_subject, email) VALUES ($1, $2)
         ON CONFLICT (auth_subject) DO UPDATE SET email = COALESCE(EXCLUDED.email, users.email)
         RETURNING id`,
        [identity.subject, identity.email ?? null],
      );
      const userId = result.rows[0]!.id;
      if (identity.email) {
        const pendingSubject = `invited:${identity.email.trim().toLowerCase()}`;
        const pending = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE auth_subject = $1 AND id <> $2`,
          [pendingSubject, userId],
        );
        if (pending.rows[0]) {
          const accepted = await client.query<{ aquariumId: string }>(
            `INSERT INTO aquarium_memberships
               (aquarium_id, user_id, role, receive_alarms, joined_at,
                invited_at, accepted_at, invitation_expires_at)
             SELECT aquarium_id, $1, role, receive_alarms, joined_at,
                    invited_at, now(), NULL
             FROM aquarium_memberships
             WHERE user_id = $2
               AND (invitation_expires_at IS NULL OR invitation_expires_at > now())
             ON CONFLICT (aquarium_id, user_id) DO UPDATE SET
               role = CASE
                 WHEN aquarium_memberships.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner'
                 WHEN aquarium_memberships.role = 'manage' OR EXCLUDED.role = 'manage' THEN 'manage'
                 WHEN aquarium_memberships.role = 'program' OR EXCLUDED.role = 'program' THEN 'program'
                 WHEN aquarium_memberships.role = 'control' OR EXCLUDED.role = 'control' THEN 'control'
                 ELSE 'view' END,
               receive_alarms = aquarium_memberships.receive_alarms OR EXCLUDED.receive_alarms,
               joined_at = LEAST(aquarium_memberships.joined_at, EXCLUDED.joined_at),
               accepted_at = now(), invitation_expires_at = NULL
             RETURNING aquarium_id AS "aquariumId"`,
            [userId, pending.rows[0].id],
          );
          for (const membership of accepted.rows) {
            await client.query(
              `INSERT INTO aquarium_authorization_audit
                 (aquarium_id, actor_user_id, target_user_id, actor_email,
                  target_email, action, details)
               VALUES ($1, $2, $2, $3, $3, 'member.accepted', '{}'::jsonb)`,
              [membership.aquariumId, userId, identity.email.trim().toLowerCase()],
            );
          }
          await client.query(`DELETE FROM users WHERE id = $1`, [pending.rows[0].id]);
        }
      }
      await client.query("COMMIT");
      return userId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async access(
    identity: Identity,
    aquariumId: string,
    includeArchived = false,
  ): Promise<{ userId: string; role: AquariumRole | null }> {
    // Aquarium primary keys are PostgreSQL UUIDs. Reject malformed route
    // parameters before they reach a typed query so a stale client identifier
    // becomes a normal not-found response instead of a database error.
    if (!postgresUuidPattern.test(aquariumId)) {
      return { userId: "", role: null };
    }
    const userId = await this.userId(identity);
    const result = await this.pool.query<{ role: AquariumRole }>(
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
    if (!hasAquariumRole(access.role, "manage")) return null;
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
    if (access.role !== "owner") return null;
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
    if (access.role !== "owner") return null;
    const result = await this.pool.query(
      `UPDATE aquariums SET archived_at = NULL
       WHERE id = $1 AND archived_at IS NOT NULL
       RETURNING id, name, created_at AS "createdAt", archived_at AS "archivedAt"`,
      [aquariumId],
    );
    return result.rows[0] ? { ...result.rows[0], role: access.role } : null;
  }

  async listAquariumMembers(identity: Identity, aquariumId: string) {
    const access = await this.access(identity, aquariumId);
    if (!access.role) return null;
    const result = await this.pool.query(
      `SELECT u.id AS "userId", u.email, m.role,
              m.receive_alarms AS "receiveAlarms", m.joined_at AS "joinedAt",
              (u.id = $2) AS "currentUser",
              (u.auth_subject LIKE 'invited:%') AS pending,
              m.invited_at AS "invitedAt", m.accepted_at AS "acceptedAt",
              m.invitation_expires_at AS "expiresAt"
       FROM aquarium_memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.aquarium_id = $1 AND ($3::boolean OR u.id = $2)
       ORDER BY CASE m.role
         WHEN 'owner' THEN 0 WHEN 'manage' THEN 1 WHEN 'program' THEN 2
         WHEN 'control' THEN 3 ELSE 4 END, lower(COALESCE(u.email, ''))`,
      [aquariumId, access.userId, hasAquariumRole(access.role, "manage")],
    );
    return result.rows;
  }

  async addAquariumMember(
    identity: Identity,
    aquariumId: string,
    email: string,
    role: Exclude<AquariumRole, "owner">,
    receiveAlarms: boolean,
  ) {
    const access = await this.access(identity, aquariumId);
    if (!hasAquariumRole(access.role, "manage")) return "forbidden" as const;
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM users
       WHERE lower(email) = $1 AND auth_subject NOT LIKE 'invited:%'
       ORDER BY created_at LIMIT 1`,
      [normalizedEmail],
    );
    const pending = existing.rows[0] ? null : await this.pool.query<{ id: string }>(
      `INSERT INTO users (auth_subject, email)
       VALUES ($1, $2)
       ON CONFLICT (auth_subject) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [`invited:${normalizedEmail}`, normalizedEmail],
    );
    const targetUserId = existing.rows[0]?.id ?? pending!.rows[0]!.id;
    const result = await this.pool.query(
      `INSERT INTO aquarium_memberships
         (aquarium_id, user_id, role, receive_alarms, invited_at,
          accepted_at, invitation_expires_at)
       VALUES ($1, $2, $3, $4, now(),
               CASE WHEN $5::boolean THEN NULL ELSE now() END,
               CASE WHEN $5::boolean THEN now() + interval '7 days' ELSE NULL END)
       ON CONFLICT (aquarium_id, user_id) DO UPDATE SET
         role = CASE WHEN aquarium_memberships.role = 'owner' THEN 'owner' ELSE EXCLUDED.role END,
         receive_alarms = CASE WHEN aquarium_memberships.role = 'owner'
           THEN aquarium_memberships.receive_alarms ELSE EXCLUDED.receive_alarms END,
         invited_at = CASE WHEN $5::boolean THEN now() ELSE aquarium_memberships.invited_at END,
         invitation_expires_at = CASE WHEN $5::boolean
           THEN now() + interval '7 days' ELSE NULL END
       RETURNING user_id AS "userId",
         (SELECT email FROM users WHERE id = user_id) AS email,
         role, receive_alarms AS "receiveAlarms", joined_at AS "joinedAt",
         ((SELECT auth_subject FROM users WHERE id = user_id) LIKE 'invited:%') AS pending,
         invited_at AS "invitedAt", accepted_at AS "acceptedAt",
         invitation_expires_at AS "expiresAt"`,
      [aquariumId, targetUserId, role, receiveAlarms, pending !== null],
    );
    await this.pool.query(
      `INSERT INTO aquarium_authorization_audit
         (aquarium_id, actor_user_id, target_user_id, actor_email,
          target_email, action, details)
       SELECT $1, $2, $3, actor.email, target.email, 'member.invited',
              jsonb_build_object('role', $4::text)
       FROM users actor, users target WHERE actor.id = $2 AND target.id = $3`,
      [aquariumId, access.userId, targetUserId, role],
    );
    return result.rows[0] ?? null;
  }

  async updateAquariumMember(
    identity: Identity,
    aquariumId: string,
    userId: string,
    update: { role?: Exclude<AquariumRole, "owner">; receiveAlarms?: boolean },
  ) {
    const access = await this.access(identity, aquariumId);
    if (!access.role) return null;
    const editingSelf = access.userId === userId;
    if (update.role !== undefined && !hasAquariumRole(access.role, "manage")) return "forbidden" as const;
    if (update.receiveAlarms !== undefined && !editingSelf) return "forbidden" as const;
    if (!editingSelf && !hasAquariumRole(access.role, "manage")) return "forbidden" as const;
    const result = await this.pool.query(
      `UPDATE aquarium_memberships m SET
         role = CASE WHEN m.role = 'owner' THEN m.role ELSE COALESCE($3, m.role) END,
         receive_alarms = COALESCE($4, m.receive_alarms)
       FROM users u
       WHERE m.aquarium_id = $1 AND m.user_id = $2 AND u.id = m.user_id
         AND (m.role <> 'owner' OR $2 = $5)
         AND ($3::text IS NULL OR m.role <> 'owner')
       RETURNING u.id AS "userId", u.email, m.role,
         m.receive_alarms AS "receiveAlarms", m.joined_at AS "joinedAt",
         (u.id = $5) AS "currentUser", (u.auth_subject LIKE 'invited:%') AS pending,
         m.invited_at AS "invitedAt", m.accepted_at AS "acceptedAt",
         m.invitation_expires_at AS "expiresAt"`,
      [aquariumId, userId, update.role ?? null, update.receiveAlarms ?? null, access.userId],
    );
    if (result.rows[0]) {
      const action = update.role !== undefined
        ? "member.role-changed"
        : "member.notification-changed";
      await this.pool.query(
        `INSERT INTO aquarium_authorization_audit
           (aquarium_id, actor_user_id, target_user_id, actor_email,
            target_email, action, details)
         SELECT $1, $2, $3, actor.email, target.email, $4,
                jsonb_build_object('role', $5::text, 'receiveAlarms', $6::boolean)
         FROM users actor, users target WHERE actor.id = $2 AND target.id = $3`,
        [aquariumId, access.userId, userId, action, update.role ?? null, update.receiveAlarms ?? null],
      );
    }
    return result.rows[0] ?? null;
  }

  async removeAquariumMember(identity: Identity, aquariumId: string, userId: string) {
    const access = await this.access(identity, aquariumId);
    if (!hasAquariumRole(access.role, "manage")) return "forbidden" as const;
    const result = await this.pool.query(
      `DELETE FROM aquarium_memberships
       WHERE aquarium_id = $1 AND user_id = $2 AND role <> 'owner'
       RETURNING user_id`,
      [aquariumId, userId],
    );
    if (result.rowCount === 1) {
      await this.pool.query(
        `INSERT INTO aquarium_authorization_audit
           (aquarium_id, actor_user_id, target_user_id, actor_email,
            target_email, action)
         SELECT $1, $2, $3, actor.email, target.email, 'member.removed'
         FROM users actor, users target WHERE actor.id = $2 AND target.id = $3`,
        [aquariumId, access.userId, userId],
      );
    }
    return result.rowCount === 1 ? "removed" as const : null;
  }

  async resendAquariumInvitation(identity: Identity, aquariumId: string, userId: string) {
    const access = await this.access(identity, aquariumId);
    if (!hasAquariumRole(access.role, "manage")) return "forbidden" as const;
    const result = await this.pool.query(
      `UPDATE aquarium_memberships membership SET
         invited_at = now(), invitation_expires_at = now() + interval '7 days'
       FROM users target
       WHERE membership.aquarium_id = $1 AND membership.user_id = $2
         AND target.id = membership.user_id AND target.auth_subject LIKE 'invited:%'
       RETURNING target.id AS "userId", target.email, membership.role,
         membership.receive_alarms AS "receiveAlarms",
         membership.joined_at AS "joinedAt", true AS pending,
         membership.invited_at AS "invitedAt", membership.accepted_at AS "acceptedAt",
         membership.invitation_expires_at AS "expiresAt"`,
      [aquariumId, userId],
    );
    if (!result.rows[0]) return null;
    await this.pool.query(
      `INSERT INTO aquarium_authorization_audit
         (aquarium_id, actor_user_id, target_user_id, actor_email,
          target_email, action)
       SELECT $1, $2, $3, actor.email, target.email, 'member.invitation-resent'
       FROM users actor, users target WHERE actor.id = $2 AND target.id = $3`,
      [aquariumId, access.userId, userId],
    );
    return result.rows[0];
  }

  async transferAquariumOwnership(identity: Identity, aquariumId: string, userId: string) {
    const access = await this.access(identity, aquariumId);
    if (access.role !== "owner") return "forbidden" as const;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query<{ email: string | null }>(
        `SELECT users.email FROM aquarium_memberships membership
         JOIN users ON users.id = membership.user_id
         WHERE membership.aquarium_id = $1 AND membership.user_id = $2
           AND membership.role = 'manage' AND users.auth_subject NOT LIKE 'invited:%'
         FOR UPDATE`,
        [aquariumId, userId],
      );
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(
        `UPDATE aquarium_memberships SET role = 'manage'
         WHERE aquarium_id = $1 AND user_id = $2 AND role = 'owner'`,
        [aquariumId, access.userId],
      );
      await client.query(
        `UPDATE aquarium_memberships SET role = 'owner'
         WHERE aquarium_id = $1 AND user_id = $2 AND role = 'manage'`,
        [aquariumId, userId],
      );
      await client.query(
        `INSERT INTO aquarium_authorization_audit
           (aquarium_id, actor_user_id, target_user_id, actor_email,
            target_email, action)
         SELECT $1, $2, $3, actor.email, target.email, 'ownership.transferred'
         FROM users actor, users target WHERE actor.id = $2 AND target.id = $3`,
        [aquariumId, access.userId, userId],
      );
      await client.query("COMMIT");
      return await this.listAquariumMembers(identity, aquariumId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listAuthorizationAudit(identity: Identity, aquariumId: string) {
    const access = await this.access(identity, aquariumId);
    if (!hasAquariumRole(access.role, "manage")) return null;
    const result = await this.pool.query(
      `SELECT id, aquarium_id AS "aquariumId", actor_email AS "actorEmail",
              target_email AS "targetEmail", action, details,
              occurred_at AS "occurredAt"
       FROM aquarium_authorization_audit WHERE aquarium_id = $1
       ORDER BY occurred_at DESC LIMIT 200`,
      [aquariumId],
    );
    return result.rows;
  }

  async deleteAccount(identity: Identity) {
    const userId = await this.userId(identity);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query<{ aquariumId: string }>(
        `SELECT aquarium_id AS "aquariumId" FROM aquarium_memberships
         WHERE user_id = $1 AND role = 'owner' ORDER BY aquarium_id FOR UPDATE`,
        [userId],
      );
      if (owned.rows.length > 0) {
        await client.query("ROLLBACK");
        return { deleted: false as const, ownedAquariumIds: owned.rows.map(({ aquariumId }) => aquariumId) };
      }
      await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await client.query("COMMIT");
      return { deleted: true as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
    if (!hasAquariumRole(access.role, "manage")) return null;
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
    if (!hasAquariumRole(access.role, "manage")) return null;
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
    if (!hasAquariumRole(access.role, "manage")) return null;
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
    if (!hasAquariumRole(access.role, "manage")) return null;
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
    if (!hasAquariumRole(access.role, "program")) return null;
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
    if (!hasAquariumRole(access.role, requiredRoleForCommand(request.type))) return null;
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
    if (!hasAquariumRole(access.role, "manage")) return null;
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
        await client.query(
          `INSERT INTO notification_deliveries
             (aquarium_id, event_id, user_id, channel, recipient, payload)
           SELECT $1, $2, membership.user_id, 'email', users.email,
             jsonb_build_object(
               'aquariumName', aquarium.name,
               'title', COALESCE($3::jsonb->>'title', 'Aquarium alert'),
               'details', $3::jsonb->>'details'
             )
           FROM aquarium_memberships membership
           JOIN users ON users.id = membership.user_id
           JOIN aquariums aquarium ON aquarium.id = membership.aquarium_id
           WHERE membership.aquarium_id = $1
             AND membership.receive_alarms = true
             AND users.email IS NOT NULL
             AND $4 = 'activity'
             AND $3::jsonb->>'category' = 'alert'
             AND $3::jsonb->>'action' = 'activated'
           ON CONFLICT (event_id, user_id, channel) DO NOTHING`,
          [request.aquariumId, event.eventId, JSON.stringify(event.document), event.type],
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
                        WHEN type IN ('routine.run', 'routine.stop', 'routine.finish')
                          THEN 'routine-control'
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

  async claimPendingEmailNotifications(limit = 25): Promise<Array<{
    id: string;
    recipient: string;
    aquariumName: string;
    title: string;
    details: string | null;
  }>> {
    const result = await this.pool.query<{
      id: string; recipient: string; aquariumName: string; title: string; details: string | null;
    }>(
      `WITH candidates AS (
         SELECT id FROM notification_deliveries
         WHERE channel = 'email' AND attempts < 5
           AND (status = 'pending' OR (status = 'processing' AND updated_at < now() - interval '5 minutes'))
         ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED
       )
       UPDATE notification_deliveries delivery
       SET status = 'processing', attempts = attempts + 1, updated_at = now()
       FROM candidates WHERE delivery.id = candidates.id
       RETURNING delivery.id, delivery.recipient,
         delivery.payload->>'aquariumName' AS "aquariumName",
         delivery.payload->>'title' AS title,
         delivery.payload->>'details' AS details`,
      [limit],
    );
    return result.rows;
  }

  async completeEmailNotification(id: string, error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE notification_deliveries SET
         status = CASE WHEN $2::text IS NULL THEN 'sent'
                       WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         last_error = $2, delivered_at = CASE WHEN $2::text IS NULL THEN now() ELSE NULL END,
         updated_at = now()
       WHERE id = $1`,
      [id, error?.slice(0, 500) ?? null],
    );
  }
}
