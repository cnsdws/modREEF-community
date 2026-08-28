import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface LocalAuthorization { token: string; expiresAt: string }
interface AuthorizedClient { tokenHash: string; expiresAtMs: number }
interface AuthorizationStateStore {
  loadState<T>(key: string): T | undefined;
  saveState<T>(key: string, value: T): void;
}

const authorizationLifetimeMs = 90 * 24 * 60 * 60 * 1000;
const authorizedClientsKey = "edge-authorized-clients";

export class LocalAuthorizationStore {
  private authorizedClients = new Map<string, AuthorizedClient>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createToken: () => string = () => randomBytes(32).toString("base64url"),
    private readonly store?: AuthorizationStateStore,
  ) {
    const clients = this.store?.loadState<AuthorizedClient[]>(authorizedClientsKey) ?? [];
    for (const client of clients) {
      if (typeof client.tokenHash === "string" && typeof client.expiresAtMs === "number" && client.expiresAtMs > this.now()) {
        this.authorizedClients.set(client.tokenHash, client);
      }
    }
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private persist(): void {
    this.store?.saveState(authorizedClientsKey, [...this.authorizedClients.values()]);
  }

  authorizeTrustedClient(): LocalAuthorization {
    const token = this.createToken();
    const expiresAtMs = this.now() + authorizationLifetimeMs;
    const tokenHash = this.hashToken(token);
    this.authorizedClients.set(tokenHash, { tokenHash, expiresAtMs });
    this.persist();
    return { token, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  isAuthorized(token: string): boolean {
    const tokenHash = this.hashToken(token);
    const client = this.authorizedClients.get(tokenHash);
    if (!client || client.expiresAtMs <= this.now()) {
      if (client) {
        this.authorizedClients.delete(tokenHash);
        this.persist();
      }
      return false;
    }
    return timingSafeEqual(Buffer.from(tokenHash), Buffer.from(client.tokenHash));
  }
}
