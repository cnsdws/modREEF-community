ALTER TABLE edges
  ADD COLUMN IF NOT EXISTS local_hostname text;
