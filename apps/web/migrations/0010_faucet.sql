-- The testnet faucet: a wallet that signs in to SendSure can get a little test USDC once, so a new team can try
-- a real payout without leaving the site. Testnet only; the USDC has no value.
CREATE TABLE IF NOT EXISTS faucet_drips (
  address TEXT PRIMARY KEY,
  amount TEXT NOT NULL,
  tx TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS faucet_drips_by_day ON faucet_drips (created_at);
