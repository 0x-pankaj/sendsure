-- Agent runs and the hash-chained decision log.

-- One agent run over an org's open claims.
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  planner TEXT NOT NULL,
  executor TEXT,
  summary TEXT,
  detail TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS runs_by_org ON runs (org, started_at);

-- Every decision the agent makes about a claim, chained per org:
--   hash = keccak256(abi.encode(prev_hash, keccak256(record)))
-- The hash is the decisionHash passed to settle(), so each payment points at its decision.
CREATE TABLE IF NOT EXISTS decisions (
  org TEXT NOT NULL,
  seq INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  rule_outcome TEXT NOT NULL,
  rule_reason TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  record TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  executor TEXT,
  tx_hash TEXT,
  tx_outcome TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org, seq)
);
CREATE INDEX IF NOT EXISTS decisions_by_claim ON decisions (claim_id);
CREATE UNIQUE INDEX IF NOT EXISTS decisions_by_hash ON decisions (hash);

-- On-chain anchors of the decision log head (Mandate.anchor).
CREATE TABLE IF NOT EXISTS anchors (
  org TEXT NOT NULL,
  anchor_seq INTEGER NOT NULL,
  decision_seq INTEGER NOT NULL,
  head TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org, anchor_seq)
);

-- The agent's latest decision on each claim (the contract's own result stays in last_outcome).
ALTER TABLE claims ADD COLUMN agent_action TEXT;
ALTER TABLE claims ADD COLUMN agent_reason TEXT;
