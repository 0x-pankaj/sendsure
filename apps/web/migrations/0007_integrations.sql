-- Integration keys: an org's owner or approver creates one for a system that keeps its books (Odoo).
-- Only a SHA-256 hash of the key is stored. A key can send bills, read their status, check addresses
-- and ask the agent to run; it can never approve, co-sign, add payees or change rules.
CREATE TABLE IF NOT EXISTS integration_keys (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS integration_keys_by_org ON integration_keys (org);

-- Bills sent by a books system become proposals, one per bill in that system.
ALTER TABLE proposals ADD COLUMN external_system TEXT;
ALTER TABLE proposals ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS proposals_by_external ON proposals (org, external_system, external_id)
  WHERE external_id IS NOT NULL;
