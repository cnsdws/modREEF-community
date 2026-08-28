CREATE TABLE IF NOT EXISTS water_alarm_settings (
  aquarium_id uuid PRIMARY KEY REFERENCES aquariums(id) ON DELETE CASCADE,
  rules jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
