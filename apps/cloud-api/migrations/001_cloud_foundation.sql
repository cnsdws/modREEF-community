CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquariums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aquarium_memberships (
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
  PRIMARY KEY (aquarium_id, user_id)
);

CREATE TABLE IF NOT EXISTS edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('online', 'offline', 'provisioning')),
  software_version text,
  device_public_key text UNIQUE,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edges_aquarium_idx ON edges(aquarium_id);

CREATE TABLE IF NOT EXISTS equipment_snapshots (
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  edge_id uuid NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  equipment_id text NOT NULL,
  document jsonb NOT NULL,
  reported_at timestamptz NOT NULL,
  PRIMARY KEY (aquarium_id, equipment_id)
);

CREATE TABLE IF NOT EXISTS cloud_commands (
  command_id text PRIMARY KEY,
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  edge_id uuid NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  equipment_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'delivered', 'completed', 'failed')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commands_edge_status_idx ON cloud_commands(edge_id, status, created_at);

CREATE TABLE IF NOT EXISTS aquarium_events (
  event_id text PRIMARY KEY,
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  edge_id uuid NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  document jsonb NOT NULL,
  UNIQUE (edge_id, sequence)
);
CREATE INDEX IF NOT EXISTS events_aquarium_time_idx ON aquarium_events(aquarium_id, occurred_at DESC);
