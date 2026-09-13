ALTER TABLE aquarium_memberships
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS invitation_expires_at timestamptz;

UPDATE aquarium_memberships membership
SET invited_at = COALESCE(invited_at, joined_at),
    accepted_at = CASE
      WHEN users.auth_subject LIKE 'invited:%' THEN accepted_at
      ELSE COALESCE(accepted_at, joined_at)
    END,
    invitation_expires_at = CASE
      WHEN users.auth_subject LIKE 'invited:%'
        THEN COALESCE(invitation_expires_at, now() + interval '30 days')
      ELSE NULL
    END
FROM users
WHERE users.id = membership.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS aquarium_single_owner_idx
  ON aquarium_memberships (aquarium_id) WHERE role = 'owner';

CREATE TABLE IF NOT EXISTS aquarium_authorization_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  target_email text,
  action text NOT NULL CHECK (action IN (
    'member.invited',
    'member.invitation-resent',
    'member.accepted',
    'member.role-changed',
    'member.removed',
    'member.notification-changed',
    'ownership.transferred'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aquarium_authorization_audit_time_idx
  ON aquarium_authorization_audit (aquarium_id, occurred_at DESC);
