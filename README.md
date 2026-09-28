# SendSure

SendSure is a payables agent for teams that pay contractors in stablecoins. It pays only a payee
who has proven their own payout address, only for a claim that payee signed, and only inside a
budget an Arc contract enforces. Then it writes each payment into the books the team already keeps.

Built during the **Tameion Agents Hackathon** (Canteen × Circle × Arc), Sep 27 – Oct 10, 2026, on
Arc testnet (chain 5042002).

## What's here

| Folder | What it is |
|---|---|
| [`contracts/`](contracts/) | PayeeRegistry and Mandate: the rules that decide whether money moves, with 47 tests. |
| [`packages/chain/`](packages/chain/) | TypeScript view of the contracts: addresses, ABIs, EIP-712 types, claim and registry helpers. Tests cross-check them against the live contracts. |
| [`packages/core/`](packages/core/) | The payout check: compares a payout list with the last one you paid (changed, new, look-alike, duplicate). |
| [`apps/web/`](apps/web/) | The web app. `/check` runs the payout check in your browser. `/org` sets up a payer: create the org, set a budget, invite payees, all by signing (SendSure pays the gas). `/verify` is where a payee proves their address by signing once, sends signed claims for invoices, or moves to a new address (both keys sign, then a wait the payer can cancel). `/api/relay/*` and `/api/org/*` check each signature, simulate, then submit. |
| [`apps/web/migrations/`](apps/web/migrations/) | The database schema (Cloudflare D1; the same SQL runs on local SQLite for tests). No payee names are stored. |
| [`scripts/`](scripts/) | `invite.ts` opens an invite for a payee. `e2e-bind.ts`, `e2e-change.ts`, `e2e-org.ts` and `e2e-claim.ts` run the flows end to end on Arc testnet ([bind](deployments/relay-e2e.json), [change](deployments/relay-e2e-change.json), [org](deployments/org-e2e.json), [claim](deployments/claim-e2e.json)). |
| [`deployments/`](deployments/) | Deployed addresses and first-party test runs with explorer links. These are sandbox runs, not traction. |

Run it: `pnpm install && pnpm test`, then `pnpm --filter @sendsure/web dev`. The relayer needs
`RELAYER_PRIVATE_KEY` (a key that only pays gas) in `apps/web/.env.local`.

## What existed before the hackathon

Everything in [`prior-work/`](prior-work/) existed before the window opened (Sun Sep 27, 00:00 ET)
and is **not** Tameion work. The first commit, tagged `tameion-baseline`, contains only those files.
[`BASELINE.md`](BASELINE.md) lists each one with its date and sha256.

Only the work done during the hackathon:
https://github.com/0x-pankaj/sendsure/compare/tameion-baseline...main

## Licences

MIT (see [`LICENSE`](LICENSE)), except:
- `prior-work/horos-spike/` keeps the AGPL-3.0-only headers it was written with.
- `prior-work/odoo-usdc-repro/addons/usdc_arc_gate/` is LGPL-3, as its manifest says.
