-- Invoices the payer uploaded and SendSure read with AI. A proposal is only a suggestion: nothing
-- is claimable until the payee confirms it by signing the claim themselves.
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  payee_ref TEXT NOT NULL,
  invoice_ref TEXT NOT NULL,
  amount TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  extraction TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  claim_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_by_payee ON proposals (org, payee_ref, status);
