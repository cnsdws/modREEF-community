ALTER TABLE aquarium_memberships
  DROP CONSTRAINT IF EXISTS aquarium_memberships_role_check;

UPDATE aquarium_memberships SET role = 'view' WHERE role = 'viewer';
UPDATE aquarium_memberships SET role = 'manage' WHERE role = 'admin';

ALTER TABLE aquarium_memberships
  ADD CONSTRAINT aquarium_memberships_role_check
  CHECK (role IN ('view', 'control', 'program', 'manage', 'owner'));

ALTER TABLE aquarium_memberships
  ADD COLUMN IF NOT EXISTS receive_alarms boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS users_email_lower_idx
  ON users (lower(email)) WHERE email IS NOT NULL;
