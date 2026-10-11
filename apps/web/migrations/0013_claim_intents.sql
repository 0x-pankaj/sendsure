-- A passkey payee's claim is left here, checked, before the page sends it on Arc (Mandate.submitClaim). If the page
-- closes between that transaction and telling SendSure, the claim is still recorded from here once Arc shows it was
-- sent; one never sent is forgotten after a day.
CREATE TABLE IF NOT EXISTS claim_intents (
  claim_id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  payee_ref TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS claim_intents_org ON claim_intents (org, payee_ref);
