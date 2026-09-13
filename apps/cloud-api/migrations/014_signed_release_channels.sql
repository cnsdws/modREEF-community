ALTER TABLE edge_release_channels
  DROP CONSTRAINT IF EXISTS edge_release_channels_channel_check;

ALTER TABLE edge_release_channels
  ADD CONSTRAINT edge_release_channels_channel_check
  CHECK (channel IN ('staging', 'production'));

ALTER TABLE edge_release_channels
  ADD COLUMN IF NOT EXISTS signature text;

ALTER TABLE edge_release_channels
  DROP CONSTRAINT IF EXISTS edge_release_channels_signature_check;

ALTER TABLE edge_release_channels
  ADD CONSTRAINT edge_release_channels_signature_check
  CHECK (signature IS NULL OR signature ~ '^[A-Za-z0-9+/]{86}==$');
