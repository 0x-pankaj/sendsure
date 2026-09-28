-- SendSure app data. SQLite dialect: the same file runs on Cloudflare D1 (production) and on
-- local SQLite (development and tests). Names of payees never reach this database.

-- One row per org the server has seen. ref_salt keeps invoice numbers unguessable on-chain:
-- refHash = keccak256(abi.encode(ref_salt, normalized invoice ref)).
CREATE TABLE IF NOT EXISTS orgs (
  org TEXT PRIMARY KEY,
  ref_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- A claim is what a payee signed (EIP-712 Claim for one Mandate). claim_id is that digest.
CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  payee_ref TEXT NOT NULL,
  payout TEXT NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  ref_hash TEXT NOT NULL,
  invoice_ref TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  valid_until INTEGER NOT NULL,
  payee_sig TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  last_outcome TEXT,
  last_reason TEXT,
  checked_at INTEGER,
  settle_tx TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (org, payee_ref, ref_hash)
);
CREATE INDEX IF NOT EXISTS claims_by_org ON claims (org, created_at);
CREATE INDEX IF NOT EXISTS claims_by_payee ON claims (org, payee_ref, created_at);
