-- Autopilot remembers why its last check failed, so the owner can see it and a short failure (an RPC
-- blip) is retried in two minutes instead of ten; repeated failures back off up to 30 minutes.
ALTER TABLE autopilot ADD COLUMN errors INTEGER NOT NULL DEFAULT 0;
ALTER TABLE autopilot ADD COLUMN last_error TEXT;
ALTER TABLE autopilot ADD COLUMN last_error_at INTEGER;
