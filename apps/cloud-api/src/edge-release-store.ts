import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export type EdgeReleaseChannel = "production" | "staging";

export interface StoredEdgeRelease {
  channel: EdgeReleaseChannel;
  sha256: string;
  size: number;
  sourceCommit: string;
  archive: Buffer;
  publishedAt: string;
  signature: string | null;
}
export interface EdgeReleaseStore {
  getRelease(channel: EdgeReleaseChannel): Promise<StoredEdgeRelease | null>;
  publishStagingRelease(input: {
    sha256: string;
    sourceCommit: string;
    archive: Buffer;
    signature: string;
  }): Promise<StoredEdgeRelease>;
  promoteStagingRelease(sourceCommit: string): Promise<StoredEdgeRelease | null>;
}

export class PostgresEdgeReleaseStore implements EdgeReleaseStore {
  constructor(private readonly pool: Pool) {}

  async getRelease(channel: EdgeReleaseChannel): Promise<StoredEdgeRelease | null> {
    const result = await this.pool.query<{
      channel: EdgeReleaseChannel;
      sha256: string;
      size: string;
      sourceCommit: string;
      archive: Buffer;
      publishedAt: Date;
      signature: string | null;
    }>(
      `SELECT channel, sha256, size_bytes::text AS size, signature,
              source_commit AS "sourceCommit", archive,
              published_at AS "publishedAt"
       FROM edge_release_channels WHERE channel = $1`,
      [channel],
    );
    const release = result.rows[0];
    return release ? {
      channel: release.channel,
      sha256: release.sha256,
      size: Number(release.size),
      sourceCommit: release.sourceCommit,
      archive: release.archive,
      publishedAt: release.publishedAt.toISOString(),
      signature: release.signature,
    } : null;
  }

  async publishStagingRelease(input: {
    sha256: string;
    sourceCommit: string;
    archive: Buffer;
    signature: string;
  }): Promise<StoredEdgeRelease> {
    const actualSha256 = createHash("sha256").update(input.archive).digest("hex");
    if (actualSha256 !== input.sha256) throw new Error("Release checksum does not match archive");
    const result = await this.pool.query<{ publishedAt: Date }>(
      `INSERT INTO edge_release_channels
         (channel, sha256, size_bytes, source_commit, archive, signature)
       VALUES ('staging', $1, $2, $3, $4, $5)
       ON CONFLICT (channel) DO UPDATE SET
         sha256 = EXCLUDED.sha256,
         size_bytes = EXCLUDED.size_bytes,
         source_commit = EXCLUDED.source_commit,
         archive = EXCLUDED.archive,
         signature = EXCLUDED.signature,
         published_at = now()
       RETURNING published_at AS "publishedAt"`,
      [input.sha256, input.archive.length, input.sourceCommit, input.archive, input.signature],
    );
    return {
      channel: "staging",
      sha256: input.sha256,
      size: input.archive.length,
      sourceCommit: input.sourceCommit,
      archive: input.archive,
      publishedAt: result.rows[0]!.publishedAt.toISOString(),
      signature: input.signature,
    };
  }

  async promoteStagingRelease(sourceCommit: string): Promise<StoredEdgeRelease | null> {
    const result = await this.pool.query(
      `INSERT INTO edge_release_channels
         (channel, sha256, size_bytes, source_commit, archive, signature, published_at)
       SELECT 'production', sha256, size_bytes, source_commit, archive, signature, now()
       FROM edge_release_channels
       WHERE channel = 'staging' AND source_commit = $1 AND signature IS NOT NULL
       ON CONFLICT (channel) DO UPDATE SET
         sha256 = EXCLUDED.sha256, size_bytes = EXCLUDED.size_bytes,
         source_commit = EXCLUDED.source_commit, archive = EXCLUDED.archive,
         signature = EXCLUDED.signature, published_at = now()
       RETURNING channel`,
      [sourceCommit],
    );
    return result.rowCount === 1 ? this.getRelease("production") : null;
  }
}

export function validPublishToken(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function validReleaseMetadata(
  sha256: string | undefined,
  sourceCommit: string | undefined,
): sha256 is string {
  return Boolean(
    sha256 && /^[a-f0-9]{64}$/.test(sha256) &&
    sourceCommit && /^[a-f0-9]{40}$/.test(sourceCommit),
  );
}

export function validReleaseSignature(signature: string | undefined): signature is string {
  return Boolean(signature && /^[A-Za-z0-9+/]{86}==$/.test(signature));
}
