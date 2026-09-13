import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Authenticator, Identity } from "./types.js";

export interface OidcOptions {
  issuer: string;
  audience: string;
  jwksUrl?: string;
}

export function normalizeOidcIssuer(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/`;
}

export class OidcAuthenticator implements Authenticator {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;
  readonly #emailBySubject = new Map<string, string>();

  constructor(options: OidcOptions) {
    this.#issuer = normalizeOidcIssuer(options.issuer);
    this.#audience = options.audience;
    this.#jwks = createRemoteJWKSet(
      new URL(options.jwksUrl ?? `${this.#issuer}.well-known/jwks.json`),
    );
  }

  async authenticate(authorization: string | undefined): Promise<Identity | null> {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (!match?.[1]) return null;
    try {
      const { payload } = await jwtVerify(match[1], this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience,
      });
      if (!payload.sub) return null;
      let email = typeof payload.email === "string" ? payload.email : this.#emailBySubject.get(payload.sub);
      if (!email) {
        try {
          const response = await fetch(`${this.#issuer}userinfo`, {
            headers: { authorization: `Bearer ${match[1]}` },
            signal: AbortSignal.timeout(5_000),
          });
          if (response.ok) {
            const profile = await response.json() as { sub?: string; email?: string };
            if (profile.sub === payload.sub && typeof profile.email === "string") email = profile.email;
          }
        } catch {
          // Profile enrichment must never turn a valid API token into a failed sign-in.
        }
      }
      if (email) this.#emailBySubject.set(payload.sub, email);
      return { subject: payload.sub, ...(email ? { email } : {}) };
    } catch {
      return null;
    }
  }
}
