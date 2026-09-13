CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aquarium_id uuid NOT NULL REFERENCES aquariums(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email')),
  recipient text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (event_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx
  ON notification_deliveries (status, updated_at)
  WHERE status IN ('pending', 'processing');
