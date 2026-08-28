CREATE TABLE IF NOT EXISTS device_snapshots (
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  edge_id uuid NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  document jsonb NOT NULL,
  reported_at timestamptz NOT NULL,
  PRIMARY KEY (aquarium_id, device_id)
);

CREATE INDEX IF NOT EXISTS device_snapshots_edge_idx
  ON device_snapshots(aquarium_id, edge_id);
