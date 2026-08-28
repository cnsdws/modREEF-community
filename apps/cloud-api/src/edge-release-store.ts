import { createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export type EdgeReleaseChannel = "production" | "staging";

export interface StoredEdgeRelease {
  channel: "staging";
  sha256: string;
  size: number;
  sourceCommit: string;
  archive: Buffer;
  publishedAt: string;
}
export interface EdgeReleaseStore {
  getStagingRelease(): Promise<StoredEdgeRelease | null>;
  publishStagingRelease(input: {
    sha256: string;
    sourceCommit: string;
    archive: Buffer;
  }): Promise<StoredEdgeRelease>;
}

export class PostgresEdgeReleaseStore implements EdgeReleaseStore {
  constructor(private readonly pool: Pool) {}

  async getStagingRelease(): Promise<StoredEdgeRelease | null> {
    const result = await this.pool.query<{
      channel: "staging";
      sha256: string;
      size: string;
      sourceCommit: string;
      archive: Buffer;
      publishedAt: Date;
    }>(
      `SELECT channel, sha256, size_bytes::text AS size,
              source_commit AS "sourceCommit", archive,
              published_at AS "publishedAt"
       FROM edge_release_channels WHERE channel = 'staging'`,
    );
    const release = result.rows[0];
    return release ? {
      channel: release.channel,
      sha256: release.sha256,
      size: Number(release.size),
      sourceCommit: release.sourceCommit,
      archive: release.archive,
      publishedAt: release.publishedAt.toISOString(),
    } : null;
  }

  async publishStagingRelease(input: {
    sha256: string;
    sourceCommit: string;
    archive: Buffer;
  }): Promise<StoredEdgeRelease> {
    const actualSha256 = createHash("sha256").update(input.archive).digest("hex");
    if (actualSha256 !== input.sha256) throw new Error("Release checksum does not match archive");
    const result = await this.pool.query<{ publishedAt: Date }>(
      `INSERT INTO edge_release_channels
         (channel, sha256, size_bytes, source_commit, archive)
       VALUES ('staging', $1, $2, $3, $4)
       ON CONFLICT (channel) DO UPDATE SET
         sha256 = EXCLUDED.sha256,
         size_bytes = EXCLUDED.size_bytes,
         source_commit = EXCLUDED.source_commit,
         archive = EXCLUDED.archive,
         published_at = now()
       RETURNING published_at AS "publishedAt"`,
      [input.sha256, input.archive.length, input.sourceCommit, input.archive],
    );
    return {
      channel: "staging",
      sha256: input.sha256,
      size: input.archive.length,
      sourceCommit: input.sourceCommit,
      archive: input.archive,
      publishedAt: result.rows[0]!.publishedAt.toISOString(),
    };
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
