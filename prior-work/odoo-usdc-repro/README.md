# Odoo 19 and USDC: three behaviours, reproduced

This repo checks what happens when an agent pays Odoo vendor bills in USDC, a six-decimal
stablecoin. It was run on a fresh **Odoo 19.0-20260908 Community** on 2026-09-26, and all eight
checks came back `CONFIRMED`. The full output is in [`results.txt`](results.txt).

| # | What we found | Why it matters for an agent that pays |
|---|---|---|
| 1 | Creating a currency with the code `USDC` fails with *"The currency code must be unique!"*. The code field holds 3 characters, so `USDC` is cut to `USD`, which already exists. | You must use a 3-letter code such as `USC`, with symbol `USDC`. |
| 2 | Odoo already has a "trusted account" switch (`allow_out_payment`, "Send Money"). Only "Validate bank account" users or admins can turn it on, and a trusted account's number can't be edited. **But no Community payment method checks it**, so the built-in "Manual" method pays an untrusted address without complaint. A payment method that opts in makes Odoo's own Register Payment wizard refuse untrusted wallets. | The defence against a changed payout address (payee substitution) is already in Odoo. It just has to be switched on. |
| 3 | In a USD company, a **$250.00 bill paid with 249.995 USDC is marked "paid"**, with no write-off line and no exchange-difference entry. 249.994999 USDC leaves 0.01 open. | Odoo absorbs up to half a cent silently. The Canteen essay describes the same kind of silent repair in ERPNext's Round Off. An automated payer must check exact amounts itself. |

Every payment goes through the same wizard as the **Register Payment** button:
`account.payment.register` → `action_create_payments`. The payments are made over XML-RPC by an
"agent" user that has only the **Invoicing** role.

## Run it

You need Docker. The script uses only the Python standard library.

```bash
./run.sh up            # or: docker compose up -d
python3 repro.py       # waits for Odoo (first start installs Invoicing, a few minutes), then runs every check
./run.sh down          # or: docker compose down — removes everything
```

While it's running, you can click around at http://127.0.0.1:18069 (login `admin` / `admin`). Look
at *Invoicing → Vendors → Bills* and the vendor *Acme Supplies*. The wallet change history shows in the
vendor's chatter.

## What's in here

| File | What it does |
|---|---|
| [`addons/usdc_arc_gate/models/payment.py`](addons/usdc_arc_gate/models/payment.py) | Adds a `usdc_arc` payment method and appends it to `_get_method_codes_needing_bank_account()`. That one line turns Odoo's own trusted-account check on for USDC payouts. |
| [`addons/usdc_arc_gate/data/payment_method.xml`](addons/usdc_arc_gate/data/payment_method.xml) | Declares the "USDC on Arc" outbound payment method. |
| [`repro.py`](repro.py) | Sets up the currency, journal, vendor, agent user and four bills, then runs the checks and prints `CONFIRMED` or `NOT REPRODUCED` for each. |
| [`run.sh`](run.sh) / [`docker-compose.yml`](docker-compose.yml) | Throwaway Postgres 16 + `odoo:19`. |

## Where this lives in Odoo's source (branch 19.0)

- `addons/account/models/account_payment.py`
  - `_get_method_codes_using_bank_account()` returns `['manual']`.
  - `_get_method_codes_needing_bank_account()` returns `[]`, so nothing checks trust.
  - `action_post()` refuses an untrusted recipient only when the method is in that list.
- `addons/account/models/res_partner_bank.py`
  - `_user_can_trust()` limits trust to "Validate bank account" users and admins; cron jobs can't set it.
  - `write()` refuses edits to a trusted account's number or partner.
  - Changes are logged in the vendor's chatter.
- `odoo/addons/base/models/res_currency.py`: the currency code is `fields.Char(size=3)`.

## Related: agents already get into Odoo with the user's rights

The Canteen deep dive says agents can only reach Odoo through a community MCP server that blocks
writes. As of September 2026, several routes run inside Odoo with the calling user's rights:
- Odoo's own AI app ships an [MCP server](https://www.odoo.com/documentation/20.0/applications/productivity/ai/mcp_server.html)
  in saas-19.4 and 20 (Enterprise).
- The community add-ons [`mcp_server`](https://apps.odoo.com/apps/modules/19.0/mcp_server) and
  [`muk_mcp`](https://apps.odoo.com/apps/modules/19.0/muk_mcp) do the same.
- Only [`erpipe-org/mcp-odoo`](https://github.com/erpipe-org/mcp-odoo) blocks writes by default.

None of them move money or check the payee before paying. That is the gap this repro points at.

## Environment

- `odoo:19` image `sha256:144175ec0039d52daff1d79f7e51c9281ca3c98b96c830feb49d09764a9f5d7c` (server `19.0-20260908`).
- `postgres:16` image `sha256:f1c3376c26f2609ab9f29f71f824103fe2fcd8ee0346485cb6122a4f93df6f94`.
- Fresh database with no demo data, company currency USD, and USDC set up as a 6-decimal
  currency at a 1:1 rate.
