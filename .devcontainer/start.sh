#!/usr/bin/env bash
# GitHub Codespaces: start the Odoo test copy (ODOO_VERSION, 19 by default) with the SendSure add-on.
# Then, in the terminal: pnpm demo-kit   (a SANDBOX payer org connected to this Odoo; no wallet needed)
set -euo pipefail
cd "$(dirname "$0")/.."
V="${ODOO_VERSION:-19}"
if [ "$V" = 19 ]; then PORT=18069; else PORT="180$V"; fi
integrations/odoo/run.sh up
cat <<MSG

Odoo $V is installing with the SendSure add-on (a few minutes the first time). Open the "Ports" tab, port $PORT,
and log in with admin / admin. Then run, in this terminal:

    pnpm demo-kit

It makes a SANDBOX payer org on Arc testnet (test USDC only), connects this Odoo to it, and prints the link your
vendor opens on their phone. Co-sign a first payment with: pnpm demo-kit cosign
MSG
