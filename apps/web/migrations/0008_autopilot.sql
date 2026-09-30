-- Autopilot: the org's owner lets the agent run on its own schedule. It gives the agent no new power:
-- the contract's budget, the co-sign rules and the cash plan apply to every run exactly as before.
-- `seen` remembers each open claim's state at the last run (check() result, co-sign, funds), so the
-- agent only runs, and only asks the model, when something actually changed.
CREATE TABLE IF NOT EXISTS autopilot (
  org TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  set_by TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  last_tick_at INTEGER,
  last_run_at INTEGER,
  last_run_id TEXT,
  last_summary TEXT,
  seen TEXT
);
CREATE INDEX IF NOT EXISTS autopilot_enabled ON autopilot (enabled, last_tick_at);
