ALTER TABLE aquariums
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS aquariums_active_idx
  ON aquariums(id)
  WHERE archived_at IS NULL;
