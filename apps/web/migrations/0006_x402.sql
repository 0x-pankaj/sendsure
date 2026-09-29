-- Paid calls from other agents (x402 over Circle Gateway Nanopayments), one row per settled payment.
CREATE TABLE IF NOT EXISTS x402_payments (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  payer TEXT NOT NULL,
  network TEXT NOT NULL,
  amount TEXT NOT NULL,
  settlement TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS x402_by_time ON x402_payments (created_at);
