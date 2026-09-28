-- The chain, indexed: every org the factory created and every event our contracts emitted.
-- The dashboard counts only from these tables, so every number links to a transaction.

CREATE TABLE IF NOT EXISTS indexer_cursor (
  name TEXT PRIMARY KEY,
  block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chain_orgs (
  org TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  treasury TEXT NOT NULL,
  tier INTEGER NOT NULL,
  block INTEGER NOT NULL,
  tx TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chain_events (
  tx TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block INTEGER NOT NULL,
  address TEXT NOT NULL,
  name TEXT NOT NULL,
  org TEXT,
  payee_ref TEXT,
  claim_id TEXT,
  payout TEXT,
  amount TEXT,
  reason INTEGER,
  decision_hash TEXT,
  PRIMARY KEY (tx, log_index)
);
CREATE INDEX IF NOT EXISTS chain_events_by_org ON chain_events (org, name);
CREATE INDEX IF NOT EXISTS chain_events_by_block ON chain_events (block);
