import {
  aquariumRoles,
  buildObserverRecommendation,
  buildReefSnapshot,
  buildReefCoachReport,
  isCloudCommandRequest,
  isEdgeSyncRequest,
  isNamedResourceRequest,
  isWaterAlarmRules,
} from "@modreef/api-contract";
import type { AquariumRole } from "@modreef/api-contract";
import type { AppRequest, AppResponse, Authenticator, CloudRepository } from "./types.js";
import type { ReefCoachProvider } from "./reef-coach-provider.js";
import type { InvitationNotifier } from "./invitation-notifier.js";

const json = (status: number, body: unknown): AppResponse => ({ status, body });

export class CloudApplication {
  constructor(
    private readonly repository: CloudRepository,
    private readonly authenticator: Authenticator,
    private readonly reefCoachProvider?: ReefCoachProvider,
    private readonly invitationNotifier?: InvitationNotifier,
  ) {}

  async handle(request: AppRequest): Promise<AppResponse> {
    if (request.method === "GET" && request.path === "/health") {
      return json(200, { name: "modreef-cloud", status: "healthy", timestamp: new Date().toISOString() });
    }
    if (request.method === "GET" && request.path === "/health/live") {
      return json(200, { name: "modreef-cloud", status: "alive", timestamp: new Date().toISOString() });
    }
    if (request.method === "GET" && request.path === "/health/ready") {
      try {
        await this.repository.checkReadiness();
        return json(200, { name: "modreef-cloud", status: "ready", timestamp: new Date().toISOString() });
      } catch {
        return json(503, { name: "modreef-cloud", status: "not-ready", timestamp: new Date().toISOString() });
      }
    }

    if (request.method === "POST" && request.path === "/v1/edge/sync") {
      const token = /^Bearer\s+(.+)$/i.exec(request.authorization ?? "")?.[1];
      if (!token) return json(401, { error: "Edge authentication required", code: "UNAUTHORIZED" });
      if (!isEdgeSyncRequest(request.body)) {
        return json(400, { error: "Invalid Edge sync payload", code: "INVALID_SYNC" });
      }
      const sync = await this.repository.synchronizeEdge(token, request.body);
      return sync ? json(200, sync) : json(401, { error: "Invalid Edge credentials", code: "UNAUTHORIZED" });
    }

    const identity = await this.authenticator.authenticate(request.authorization);
    if (!identity) return json(401, { error: "Authentication required", code: "UNAUTHORIZED" });

    if (request.method === "GET" && request.path === "/v1/aquariums") {
      return json(200, { aquariums: await this.repository.listAquariums(identity) });
    }
    if (request.method === "GET" && request.path === "/v1/aquariums/archived") {
      return json(200, { aquariums: await this.repository.listArchivedAquariums(identity) });
    }
    if (request.method === "POST" && request.path === "/v1/aquariums") {
      if (!isNamedResourceRequest(request.body)) {
        return json(400, { error: "Aquarium name is required", code: "INVALID_AQUARIUM" });
      }
      const aquarium = await this.repository.createAquarium(identity, request.body.name.trim());
      return json(201, { aquarium });
    }
    if (request.method === "DELETE" && request.path === "/v1/account") {
      const result = await this.repository.deleteAccount(identity);
      return result.deleted
        ? json(200, { deleted: true })
        : json(409, {
          error: "Transfer ownership or remove every owned aquarium before deleting this account",
          code: "ACCOUNT_OWNS_AQUARIUMS",
          ownedAquariumIds: result.ownedAquariumIds,
        });
    }

    const exportMatch = /^\/v1\/aquariums\/([^/]+)\/export$/.exec(request.path);
    if (request.method === "GET" && exportMatch) {
      const aquariumId = exportMatch[1]!;
      const [aquarium, controllers, devices, equipment, events, waterAlarmSettings, members, authorizationAudit] = await Promise.all([
        this.repository.getAquarium(identity, aquariumId),
        this.repository.listEdges(identity, aquariumId),
        this.repository.listDevices(identity, aquariumId),
        this.repository.listEquipment(identity, aquariumId),
        this.repository.listEvents(identity, aquariumId, 100_000),
        this.repository.getWaterAlarmSettings(identity, aquariumId),
        this.repository.listAquariumMembers(identity, aquariumId),
        this.repository.listAuthorizationAudit(identity, aquariumId),
      ]);
      if (!aquarium || !controllers || !devices || !equipment || !events || !members) return this.notFound();
      return json(200, {
        export: {
          schemaVersion: "1", exportedAt: new Date().toISOString(), aquarium,
          controllers, devices, equipment, events,
          waterAlarmSettings: waterAlarmSettings ?? null,
          members,
          authorizationAudit: authorizationAudit ?? [],
        },
      });
    }

    const archiveMatch = /^\/v1\/aquariums\/([^/]+)\/archive$/.exec(request.path);
    if (request.method === "POST" && archiveMatch) {
      const result = await this.repository.archiveAquarium(identity, archiveMatch[1]!);
      if (result === null) return this.notFound();
      if (result.status === "blocked") {
        return json(409, {
          error: "Remove or transfer every Reef Controller before archiving this aquarium",
          code: "AQUARIUM_HAS_CONTROLLERS",
          controllerIds: result.controllerIds,
        });
      }
      return json(200, { aquarium: result.aquarium });
    }
    const restoreMatch = /^\/v1\/aquariums\/([^/]+)\/restore$/.exec(request.path);
    if (request.method === "POST" && restoreMatch) {
      const aquarium = await this.repository.restoreAquarium(identity, restoreMatch[1]!);
      return aquarium ? json(200, { aquarium }) : this.notFound();
    }

    const membersMatch = /^\/v1\/aquariums\/([^/]+)\/members(?:\/([^/]+))?$/.exec(request.path);
    if (membersMatch) {
      const aquariumId = membersMatch[1]!;
      const memberId = membersMatch[2];
      if (request.method === "GET" && !memberId) {
        const members = await this.repository.listAquariumMembers(identity, aquariumId);
        return members ? json(200, { members }) : this.notFound();
      }
      if (request.method === "POST" && !memberId) {
        const body = request.body as Record<string, unknown> | null;
        const role = body?.role;
        if (typeof body?.email !== "string" || !/^\S+@\S+\.\S+$/.test(body.email) ||
            !isAssignableRole(role)) {
          return json(400, { error: "A valid email and access level are required", code: "INVALID_MEMBER" });
        }
        const member = await this.repository.addAquariumMember(
          identity, aquariumId, body.email, role,
          typeof body.receiveAlarms === "boolean" ? body.receiveAlarms : true,
        );
        if (member === "forbidden") return this.forbidden();
        if (member?.pending && member.email) {
          await this.deliverInvitation(identity, aquariumId, member);
        }
        return member ? json(201, { member }) : this.notFound();
      }
      if (request.method === "PATCH" && memberId) {
        const body = request.body as Record<string, unknown> | null;
        const role = body?.role;
        const receiveAlarms = body?.receiveAlarms;
        if ((role === undefined && receiveAlarms === undefined) ||
            (role !== undefined && !isAssignableRole(role)) ||
            (receiveAlarms !== undefined && typeof receiveAlarms !== "boolean")) {
          return json(400, { error: "Invalid member update", code: "INVALID_MEMBER" });
        }
        const member = await this.repository.updateAquariumMember(identity, aquariumId, memberId, {
          ...(role !== undefined ? { role } : {}),
          ...(typeof receiveAlarms === "boolean" ? { receiveAlarms } : {}),
        });
        return member === "forbidden" ? this.forbidden()
          : member ? json(200, { member }) : this.notFound();
      }
      if (request.method === "DELETE" && memberId) {
        const result = await this.repository.removeAquariumMember(identity, aquariumId, memberId);
        return result === "forbidden" ? this.forbidden()
          : result === "removed" ? json(200, { deleted: true }) : this.notFound();
      }
    }

    const resendInvitationMatch = /^\/v1\/aquariums\/([^/]+)\/members\/([^/]+)\/resend$/.exec(request.path);
    if (request.method === "POST" && resendInvitationMatch) {
      const member = await this.repository.resendAquariumInvitation(
        identity, resendInvitationMatch[1]!, resendInvitationMatch[2]!,
      );
      if (member === "forbidden") return this.forbidden();
      if (member?.email) await this.deliverInvitation(identity, resendInvitationMatch[1]!, member);
      return member ? json(200, { member }) : this.notFound();
    }

    const transferOwnershipMatch = /^\/v1\/aquariums\/([^/]+)\/members\/([^/]+)\/transfer-ownership$/.exec(request.path);
    if (request.method === "POST" && transferOwnershipMatch) {
      const members = await this.repository.transferAquariumOwnership(
        identity, transferOwnershipMatch[1]!, transferOwnershipMatch[2]!,
      );
      return members === "forbidden" ? this.forbidden()
        : members ? json(200, { members }) : this.notFound();
    }

    const authorizationAuditMatch = /^\/v1\/aquariums\/([^/]+)\/authorization-audit$/.exec(request.path);
    if (request.method === "GET" && authorizationAuditMatch) {
      const events = await this.repository.listAuthorizationAudit(
        identity, authorizationAuditMatch[1]!,
      );
      return events ? json(200, { events }) : this.notFound();
    }

    const coachMatch = /^\/v1\/aquariums\/([^/]+)\/coach$/.exec(request.path);
    if (request.method === "GET" && coachMatch) {
      const aquariumId = coachMatch[1]!;
      const [aquarium, snapshots, events] = await Promise.all([
        this.repository.getAquarium(identity, aquariumId),
        this.repository.listEquipment(identity, aquariumId),
        this.repository.listEvents(identity, aquariumId, 1000),
      ]);
      if (!aquarium || !snapshots || !events) return this.notFound();
      return json(200, {
        report: buildReefCoachReport({
          aquarium,
          equipment: snapshots.map(({ document }) => document),
          events,
        }),
      });
    }
    const waterAlarmMatch = /^\/v1\/aquariums\/([^/]+)\/water-alarm-settings$/.exec(request.path);
    if (request.method === "GET" && waterAlarmMatch) {
      const settings = await this.repository.getWaterAlarmSettings(identity, waterAlarmMatch[1]!);
      return settings === null ? this.notFound() : json(200, { settings: settings ?? null });
    }
    if (request.method === "PUT" && waterAlarmMatch) {
      const rules = request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>).rules : undefined;
      if (!isWaterAlarmRules(rules)) {
        return json(400, { error: "Invalid water alarm settings", code: "INVALID_WATER_ALARMS" });
      }
      const settings = await this.repository.saveWaterAlarmSettings(
        identity, waterAlarmMatch[1]!, rules,
      );
      return settings ? json(200, { settings }) : this.notFound();
    }
    const coachAnalysisMatch = /^\/v1\/aquariums\/([^/]+)\/coach\/analyze$/.exec(request.path);
    if (request.method === "POST" && coachAnalysisMatch) {
      const aquariumId = coachAnalysisMatch[1]!;
      const [aquarium, snapshots, events] = await Promise.all([
        this.repository.getAquarium(identity, aquariumId),
        this.repository.listEquipment(identity, aquariumId),
        this.repository.listEvents(identity, aquariumId, 1000),
      ]);
      if (!aquarium || !snapshots || !events) return this.notFound();
      const snapshot = buildReefSnapshot({
        aquarium, equipment: snapshots.map(({ document }) => document), events,
      });
      if (!this.reefCoachProvider) return json(200, {
        report: {
          snapshot,
          recommendation: buildObserverRecommendation(snapshot),
          generation: { mode: "deterministic", fallbackReason: "Model analysis is not configured." },
        },
      });
      try {
        return json(200, {
          report: {
            snapshot,
            recommendation: await this.reefCoachProvider.analyze(snapshot),
            generation: {
              mode: "model", provider: this.reefCoachProvider.name,
              model: this.reefCoachProvider.model,
            },
          },
        });
      } catch (error) {
        console.warn("Reef Coach model analysis fell back to observer rules:", error);
        return json(200, {
          report: {
            snapshot,
            recommendation: buildObserverRecommendation(snapshot),
            generation: { mode: "deterministic", fallbackReason: "Model analysis was unavailable." },
          },
        });
      }
    }

    const edgeMatch = /^\/v1\/aquariums\/([^/]+)\/edges\/([^/]+)$/.exec(request.path);
    if (request.method === "PATCH" && edgeMatch) {
      if (!isNamedResourceRequest(request.body)) {
        return json(400, { error: "Reef Controller name is required", code: "INVALID_EDGE" });
      }
      const edge = await this.repository.renameEdge(
        identity, edgeMatch[1]!, edgeMatch[2]!, request.body.name.trim(),
      );
      return edge ? json(200, { edge }) : this.notFound();
    }
    if (request.method === "DELETE" && edgeMatch) {
      const result = await this.repository.retireEdge(
        identity, edgeMatch[1]!, edgeMatch[2]!,
      );
      if (result === null) return this.notFound();
      if (result.status === "blocked") {
        return json(409, {
          error: "Remove every device before removing this Reef Controller",
          code: "CONTROLLER_HAS_DEVICES",
          deviceIds: result.deviceIds,
          equipmentIds: result.equipmentIds,
        });
      }
      return json(200, { deleted: true });
    }
    const reprovisionMatch = /^\/v1\/aquariums\/([^/]+)\/edges\/([^/]+)\/reprovision$/.exec(request.path);
    if (request.method === "POST" && reprovisionMatch) {
      const credentials = await this.repository.reprovisionEdge(
        identity, reprovisionMatch[1]!, reprovisionMatch[2]!,
      );
      return credentials ? json(200, { credentials }) : this.notFound();
    }
    const localAuthorizationMatch = /^\/v1\/aquariums\/([^/]+)\/edges\/([^/]+)\/local-authorization$/.exec(request.path);
    if (request.method === "POST" && localAuthorizationMatch) {
      const authorization = await this.repository.createLocalAuthorization(
        identity, localAuthorizationMatch[1]!, localAuthorizationMatch[2]!,
      );
      return authorization ? json(200, { authorization }) : this.notFound();
    }

    const commandMatch = /^\/v1\/aquariums\/([^/]+)\/commands\/([^/]+)$/.exec(request.path);
    if (request.method === "GET" && commandMatch) {
      const command = await this.repository.getCommand(
        identity, commandMatch[1]!, commandMatch[2]!,
      );
      return command ? json(200, { command }) : this.notFound();
    }

    const match = /^\/v1\/aquariums\/([^/]+)(?:\/(edges|devices|equipment|events|commands))?$/.exec(request.path);
    const aquariumId = match?.[1];
    if (!aquariumId) return json(404, { error: "Not found", code: "NOT_FOUND" });
    const resource = match?.[2];

    if (request.method === "GET" && !resource) {
      const aquarium = await this.repository.getAquarium(identity, aquariumId);
      return aquarium ? json(200, { aquarium }) : this.notFound();
    }
    if (request.method === "PATCH" && !resource) {
      if (!isNamedResourceRequest(request.body)) {
        return json(400, { error: "Aquarium name is required", code: "INVALID_AQUARIUM" });
      }
      const aquarium = await this.repository.renameAquarium(
        identity, aquariumId, request.body.name.trim(),
      );
      return aquarium ? json(200, { aquarium }) : this.notFound();
    }
    if (request.method === "GET" && resource === "edges") {
      const edges = await this.repository.listEdges(identity, aquariumId);
      return edges ? json(200, { edges }) : this.notFound();
    }
    if (request.method === "POST" && resource === "edges") {
      if (!isNamedResourceRequest(request.body)) {
        return json(400, { error: "Edge name is required", code: "INVALID_EDGE" });
      }
      const credentials = await this.repository.registerEdge(identity, aquariumId, request.body.name.trim());
      return credentials ? json(201, { credentials }) : this.notFound();
    }
    if (request.method === "GET" && resource === "equipment") {
      const equipment = await this.repository.listEquipment(identity, aquariumId);
      return equipment ? json(200, { equipment }) : this.notFound();
    }
    if (request.method === "GET" && resource === "devices") {
      const devices = await this.repository.listDevices(identity, aquariumId);
      return devices ? json(200, { devices }) : this.notFound();
    }
    if (request.method === "GET" && resource === "events") {
      const events = await this.repository.listEvents(identity, aquariumId, 1000);
      return events ? json(200, { events }) : this.notFound();
    }
    if (request.method === "POST" && resource === "commands") {
      if (!isCloudCommandRequest(request.body)) {
        return json(400, { error: "Invalid command", code: "INVALID_COMMAND" });
      }
      const command = await this.repository.createCommand(identity, aquariumId, request.body);
      return command ? json(202, { command }) : this.notFound();
    }
    return json(405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  private notFound(): AppResponse {
    // Deliberately hides whether another tenant owns the resource.
    return json(404, { error: "Aquarium not found", code: "NOT_FOUND" });
  }

  private forbidden(): AppResponse {
    return json(403, { error: "Your aquarium access level does not allow this action", code: "FORBIDDEN" });
  }

  private async deliverInvitation(
    identity: import("./types.js").Identity,
    aquariumId: string,
    member: import("@modreef/api-contract").AquariumMember,
  ): Promise<void> {
    if (!this.invitationNotifier || !member.email) return;
    const aquarium = await this.repository.getAquarium(identity, aquariumId).catch(() => null);
    await this.invitationNotifier.sendInvitation({
      aquariumId,
      aquariumName: aquarium?.name ?? "a modREEF aquarium",
      email: member.email,
      invitedBy: identity.email ?? null,
      expiresAt: member.expiresAt ?? null,
    }).catch((error) => console.error("Invitation email delivery failed:", error instanceof Error ? error.message : "unknown error"));
  }
}

function isAssignableRole(value: unknown): value is Exclude<AquariumRole, "owner"> {
  return aquariumRoles.includes(value as AquariumRole) && value !== "owner";
}
