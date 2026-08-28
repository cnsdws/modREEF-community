ALTER TABLE edges
  ADD COLUMN IF NOT EXISTS device_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS edges_device_token_hash_idx
  ON edges(device_token_hash)
  WHERE device_token_hash IS NOT NULL;

-- Provisioning stores SHA-256(token) as lowercase hexadecimal. The raw token
-- is shown once to the Edge owner and is never stored by the cloud service.
