#!/usr/bin/env bash
# Lists the teams that asked to be set up (newest first), from the live database.
#   scripts/leads.sh
cd "$(dirname "$0")/../apps/web" && npx wrangler d1 execute sendsure --remote --command \
  "SELECT datetime(created_at,'unixepoch') AS at, source, team, contact, pays_in, payees, next_payout, note FROM leads ORDER BY created_at DESC LIMIT 50"
