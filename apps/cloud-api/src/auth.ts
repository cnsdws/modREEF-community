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
      return {
        subject: payload.sub,
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      };
    } catch {
      return null;
    }
  }
}
