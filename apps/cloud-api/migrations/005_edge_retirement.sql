ALTER TABLE edges
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

CREATE INDEX IF NOT EXISTS edges_active_aquarium_idx
  ON edges(aquarium_id)
  WHERE retired_at IS NULL;
