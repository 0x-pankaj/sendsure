-- Owner signatures the relayer has acted on (create an org, open invites), so a replay is caught on every Worker
-- instance, not only the one that saw it first. Kept until the signature has expired.
CREATE TABLE IF NOT EXISTS used_signatures (
  sig TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS used_signatures_expiry ON used_signatures (expires_at);
