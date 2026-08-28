ALTER TABLE edges
  ADD COLUMN IF NOT EXISTS runtime_state jsonb NOT NULL DEFAULT '{"feedCycle":null}'::jsonb;
