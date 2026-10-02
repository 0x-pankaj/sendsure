-- Teams that asked to be set up (the "Get set up" form). They typed these details in themselves and
-- ticked the consent box; nothing here is shown publicly.
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  team TEXT NOT NULL,
  contact TEXT NOT NULL,
  pays_in TEXT NOT NULL DEFAULT '',
  payees INTEGER,
  next_payout TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Where an org's owner wants to hear about claims, co-signs and payments (a Discord or Slack webhook).
CREATE TABLE IF NOT EXISTS org_notify (
  org TEXT PRIMARY KEY,
  webhook_url TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  last_error TEXT
);

-- Anonymous counts only: which event, on which day, how many times. No addresses, amounts or files.
CREATE TABLE IF NOT EXISTS usage_counts (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event)
);
