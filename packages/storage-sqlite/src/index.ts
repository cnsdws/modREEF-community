import { DatabaseSync } from "node:sqlite";

import type {
  AquariumDigitalTwin,
  AquariumEvent,
} from "@modreef/digital-twin";

interface TwinRow {
  document: string;
}

interface AquariumEventRow {
  document: string;
}

export interface AquariumEventCursor {
  recordedAt: string;
  eventId: string;
}

interface IntegrityCheckRow {
  quick_check: string;
}

export class SqliteTwinStore {
  private readonly database: DatabaseSync;

  constructor(filename: string) {
    this.database = new DatabaseSync(filename);

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS digital_twins (
        aquarium_id TEXT PRIMARY KEY,
        document TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_state (
        key TEXT PRIMARY KEY,
        document TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS aquarium_events (
        event_id TEXT PRIMARY KEY,
        aquarium_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        document TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS aquarium_events_timeline
      ON aquarium_events (
        aquarium_id,
        occurred_at DESC,
        recorded_at DESC
      );

      CREATE INDEX IF NOT EXISTS aquarium_events_retention
      ON aquarium_events (occurred_at);
    `);
  }

  load(aquariumId: string): AquariumDigitalTwin | undefined {
    const row = this.database
      .prepare(`
        SELECT document
        FROM digital_twins
        WHERE aquarium_id = ?
      `)
      .get(aquariumId) as unknown as TwinRow | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.document) as AquariumDigitalTwin;
  }

  save(twin: AquariumDigitalTwin): void {
    this.database
      .prepare(`
        INSERT INTO digital_twins (
          aquarium_id,
          document,
          updated_at
        )
        VALUES (?, ?, ?)
        ON CONFLICT(aquarium_id) DO UPDATE SET
          document = excluded.document,
          updated_at = excluded.updated_at
      `)
      .run(
        twin.aquarium.id,
        JSON.stringify(twin),
        new Date().toISOString(),
      );
  }

  loadState<T>(key: string): T | undefined {
    const row = this.database
      .prepare(`
        SELECT document
        FROM runtime_state
        WHERE key = ?
      `)
      .get(key) as unknown as TwinRow | undefined;

    return row
      ? JSON.parse(row.document) as T
      : undefined;
  }

  saveState<T>(key: string, value: T): void {
    this.database
      .prepare(`
        INSERT INTO runtime_state (
          key,
          document,
          updated_at
        )
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          document = excluded.document,
          updated_at = excluded.updated_at
      `)
      .run(
        key,
        JSON.stringify(value),
        new Date().toISOString(),
      );
  }

  deleteState(key: string): void {
    this.database
      .prepare(`
        DELETE FROM runtime_state
        WHERE key = ?
      `)
      .run(key);
  }

  appendEvent(event: AquariumEvent): void {
    this.database
      .prepare(`
        INSERT INTO aquarium_events (
          event_id,
          aquarium_id,
          event_type,
          occurred_at,
          recorded_at,
          document
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.id,
        event.aquariumId,
        event.type,
        event.occurredAt,
        event.recordedAt,
        JSON.stringify(event),
      );
  }

  updateEvent(event: AquariumEvent): boolean {
    const result = this.database
      .prepare(`
        UPDATE aquarium_events
        SET
          event_type = ?,
          occurred_at = ?,
          recorded_at = ?,
          document = ?
        WHERE aquarium_id = ? AND event_id = ?
      `)
      .run(
        event.type,
        event.occurredAt,
        event.recordedAt,
        JSON.stringify(event),
        event.aquariumId,
        event.id,
      );

    return Number(result.changes) > 0;
  }

  purgeEventsBefore(cutoff: Date): number {
    if (Number.isNaN(cutoff.getTime())) {
      throw new Error("Event retention cutoff must be a valid date");
    }

    const result = this.database
      .prepare(`
        DELETE FROM aquarium_events
        WHERE occurred_at < ?
      `)
      .run(cutoff.toISOString());

    return Number(result.changes);
  }

  deleteEvent(
    aquariumId: string,
    eventId: string,
  ): boolean {
    const result = this.database
      .prepare(`
        DELETE FROM aquarium_events
        WHERE aquarium_id = ? AND event_id = ?
      `)
      .run(aquariumId, eventId);

    return Number(result.changes) > 0;
  }

  listEvents(
    aquariumId: string,
    limit = 100,
  ): AquariumEvent[] {
    const safeLimit = Math.min(
      Math.max(Math.trunc(limit), 1),
      1000,
    );

    const rows = this.database
      .prepare(`
        SELECT document
        FROM aquarium_events
        WHERE aquarium_id = ?
        ORDER BY
          occurred_at DESC,
          recorded_at DESC,
          event_id DESC
        LIMIT ?
      `)
      .all(
        aquariumId,
        safeLimit,
      ) as unknown as AquariumEventRow[];

    return rows.map(
      (row) => JSON.parse(row.document) as AquariumEvent,
    );
  }

  listEventsAfter(
    aquariumId: string,
    cursor: AquariumEventCursor | undefined,
    limit = 100,
  ): AquariumEvent[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const rows = this.database.prepare(`
      SELECT document FROM aquarium_events
      WHERE aquarium_id = ? AND (
        ? IS NULL OR recorded_at > ? OR (recorded_at = ? AND event_id > ?)
      )
      ORDER BY recorded_at ASC, event_id ASC
      LIMIT ?
    `).all(
      aquariumId,
      cursor?.recordedAt ?? null,
      cursor?.recordedAt ?? null,
      cursor?.recordedAt ?? null,
      cursor?.eventId ?? null,
      safeLimit,
    ) as unknown as AquariumEventRow[];
    return rows.map((row) => JSON.parse(row.document) as AquariumEvent);
  }

  checkHealth(): void {
    const integrity = this.database
      .prepare("PRAGMA quick_check(1)")
      .get() as unknown as IntegrityCheckRow | undefined;

    if (integrity?.quick_check !== "ok") {
      throw new Error(
        `SQLite integrity check failed: ${integrity?.quick_check ?? "no result"}`,
      );
    }

    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.database
        .prepare(`
          INSERT INTO runtime_state (
            key,
            document,
            updated_at
          )
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            document = excluded.document,
            updated_at = excluded.updated_at
        `)
        .run(
          "__modreef_health_probe__",
          "{}",
          new Date().toISOString(),
        );
      this.database.exec("ROLLBACK");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original database failure.
      }

      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}
