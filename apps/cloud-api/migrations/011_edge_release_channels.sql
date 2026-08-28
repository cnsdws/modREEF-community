CREATE TABLE IF NOT EXISTS edge_release_channels (
  channel text PRIMARY KEY CHECK (channel IN ('staging')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  source_commit text NOT NULL CHECK (source_commit ~ '^[a-f0-9]{40}$'),
  archive bytea NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
