import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { EdgeSyncRequest } from "@modreef/api-contract";

import { PostgresCloudRepository } from "../src/postgres-repository.js";

interface RecordedQuery {
  text: string;
  values: unknown[];
}

class FakeClient {
  readonly queries: RecordedQuery[] = [];

  async query<T>(text: string, values: unknown[] = []) {
    this.queries.push({ text, values });
    const authenticated = text.includes("device_token_hash");
    return {
      rows: [] as T[],
      rowCount: authenticated ? 1 : 0,
    };
  }

  release() {}
}

function request(equipmentIds: string[]): EdgeSyncRequest {
  return {
    edgeId: "edge-1",
    aquariumId: "reef-a",
    softwareVersion: "0.1.0",
    uptimeSeconds: 10,
    localHostname: "test-edge",
    equipment: equipmentIds.map((equipmentId) => ({
      equipmentId,
      edgeId: "edge-1",
      document: { id: equipmentId },
      reportedAt: "2026-07-28T22:00:00.000Z",
    })),
    events: [],
    commandResults: [],
    runtimeState: { feedCycle: null },
  };
}

describe("cloud equipment reconciliation", () => {
  it("rejects malformed aquarium identifiers before querying PostgreSQL", async () => {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async <T>(text: string, values: unknown[] = []) => {
        queries.push({ text, values });
        return { rows: [] as T[], rowCount: 0 };
      },
    } as unknown as Pool;
    const repository = new PostgresCloudRepository(pool);

    expect(await repository.getWaterAlarmSettings(
      { subject: "auth0|test" },
      "dennis-display-reef",
    )).toBeNull();
    expect(queries).toEqual([]);
  });

  it("deletes snapshots missing from an Edge's authoritative inventory", async () => {
    const client = new FakeClient();
    const pool = {
      connect: async () => client,
    } as unknown as Pool;
    const repository = new PostgresCloudRepository(pool);

    await repository.synchronizeEdge("edge-secret", request(["pump-1", "pump-2"]));

    const deletion = client.queries.find((query) =>
      query.text.includes("DELETE FROM equipment_snapshots"),
    );
    expect(deletion?.values).toEqual([
      "reef-a",
      "edge-1",
      ["pump-1", "pump-2"],
    ]);
    expect(deletion?.text).toContain("edge_id = $2");
  });

  it("removes all snapshots for an Edge reporting an empty inventory", async () => {
    const client = new FakeClient();
    const pool = {
      connect: async () => client,
    } as unknown as Pool;
    const repository = new PostgresCloudRepository(pool);

    await repository.synchronizeEdge("edge-secret", request([]));

    const deletion = client.queries.find((query) =>
      query.text.includes("DELETE FROM equipment_snapshots"),
    );
    expect(deletion?.values[2]).toEqual([]);
  });

  it("stores the controller's reported runtime state with its heartbeat", async () => {
    const client = new FakeClient();
    const pool = { connect: async () => client } as unknown as Pool;
    const repository = new PostgresCloudRepository(pool);
    const sync = request([]);
    sync.runtimeState = {
      feedCycle: {
        id: "feed-1", status: "feeding", startedAt: "2026-07-31T12:00:00Z",
        endsAt: "2026-07-31T12:05:00Z", durationSeconds: 300,
      },
    };
    await repository.synchronizeEdge("edge-secret", sync);
    const heartbeat = client.queries.find((query) => query.text.includes("runtime_state ="));
    expect(heartbeat?.values[4]).toBe(JSON.stringify(sync.runtimeState));
  });

  it("expires, supersedes, and prioritizes transient operational commands", async () => {
    const client = new FakeClient();
    const pool = { connect: async () => client } as unknown as Pool;
    const repository = new PostgresCloudRepository(pool);

    await repository.synchronizeEdge("edge-secret", request([]));

    const expiry = client.queries.find((query) =>
      query.text.includes("Operational command expired before delivery"),
    );
    const supersession = client.queries.find((query) =>
      query.text.includes("Operational command superseded by a newer request"),
    );
    const delivery = client.queries.find((query) =>
      query.text.includes("UPDATE cloud_commands SET status = 'delivered'"),
    );
    expect(expiry?.text).toContain("interval '2 minutes'");
    expect(supersession?.text).toContain("row_number() OVER");
    expect(delivery?.text).toContain("WHEN type = ANY($2::text[]) THEN 0");
    expect(delivery?.text).toContain("WHEN type LIKE 'aquarium.event.%' THEN 2");
    expect(delivery?.values[1]).toContain("equipment.set-control-mode");
    expect(delivery?.values[1]).toContain("routine.run");
    expect(supersession?.text).toContain("THEN 'routine-control'");
  });
});
