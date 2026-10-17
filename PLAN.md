# SendSure build plan: the source of truth

> Judges: this is the working build log. The submission is [README.md](README.md).

> **Any new session starts here.** Read "Resume here", do the next unchecked task, then follow the
> working agreement. This file is updated in the same commit as the work it describes.

## Resume here

- **Status:** see the task table; ✅ = done and pushed.
- **Oct 17: mainnet beta (branch `mainnet`, worktree `../sendsure-mainnet`; `main` and the testnet site untouched)** for
  the [Arc OSS mainnet bounty](https://arc-oss.thecanteenapp.com/#mainnet-bounty) (deploy to Arc mainnet, verify on
  Blockscout or Sourcify, post on X, re-run `arc-canteen submit-showcase`). One build switch,
  `NEXT_PUBLIC_ARC_NETWORK=mainnet`, picks the chain (5042), deployment, EIP-712 domains, agents and relayer. Mainnet USDC
  is byte-identical to testnet's (proxy and implementation code hashes checked). Beta limits, enforced by the relayer and
  by the agent at every run: 10 USDC a bill, 50 per payee, 100 a period, co-sign above 5, periods of 30+ days, budgets of
  100 or less, production orgs only; a daily gas budget per key. Off on mainnet: faucet, /try and test wallets, passkeys,
  x402 and the Circle agent wallet. Server RPCs fail over across Circle's,
  QuickNode's, dRPC's and Blockdaemon's mainnet endpoints (`ARC_RPC_URL`, comma-separated).
  **Checked before funding:** an independent review (1 blocker, 4 high, all fixed: 55bd4c7), `scripts/rehearse-mainnet.sh`
  36/36 on an anvil fork of Arc mainnet with the real deployer key (same addresses as the real deploy), and a mainnet
  production build with no key in the bundle. Fresh keys, never committed: deployer `0x000E…4b05`
  (`contracts/.env.mainnet`), relayer `0x51c3…Cf19`, server agent `0x59f3…035B` (`apps/web/.env.mainnet.local`, which
  also holds the Worker's other secrets). D1 `sendsure-mainnet` migrated. The same invite/autopilot blocker exists on
  `main` (testnet gas only): fix it there after the hackathon submission, with Pankaj's OK.
  **ERP on mainnet (Oct 17 afternoon):** Pankaj says two companies agreed to test on mainnet (not in writing yet: name
  nobody until they OK it in writing). The add-ons now follow the chain SendSure names on every answer (header
  `x-sendsure-chain`; Odoo 1.3.0, ERPNext 15.0.2): vendor emails say real USDC on mainnet, transaction links use the
  server's `tx_url` (or the chain's explorer), "Add USDC" instead of "Add test USDC"; testnet until a server says
  otherwise. Odoo 16–19 39/39 each, ERPNext 15–16 31/31 each. "Connect your books" (`/api/org/keys`) is on for the
  mainnet beta too, with Pankaj's OK (the auto-mode check had refused it first).
  **Deployed Oct 17, 15:08 Kathmandu** (block 26410298, from 80c82a4), at the rehearsed addresses: PayeeRegistry
  `0xdDAd8354D2Ad14DE137D4147B303747885D70db3`, MandateFactory `0x444Ee1C5721822ec2ECA2e52E85911CA5B1caf93`, Mandate
  implementation `0x6a98994c7348aE13024F2F252D9c7d68622b6BBC`. 6.7M gas, 0.147 USDC; all three verified on Sourcify
  (exact match). `deployments/arc-mainnet.json`, `pnpm gen` done. The deployer (0.363 USDC left) has no power left:
  `setFactory` was its one call. Send its leftover back to Pankaj once he names an address.
  **Left, in order (from the worktree):**
  1. ~~Fund the deployer, deploy, record, verify~~ (done, above). Pankaj funds relayer 1 and agent 1 USDC (gas ~21.7
     gwei, base fee flat at 20: a new org ~0.01, a payee proof ~0.003, a payment 0.002–0.008; an idle site sends nothing).
  2. `wrangler secret bulk --env mainnet` from `apps/web/.env.mainnet.local` (never echoed); `pnpm --filter @sendsure/web
     cf:deploy:mainnet` from the worktree (it has no `.env.local`, so no testnet value is bundled).
  3. One small real payment with Pankaj's own wallets (`FIRST_PARTY_ADDRESSES`: first-party, never traction).
  4. README note, honest X post (no outside users yet), `arc-canteen submit-showcase`.
- **Oct 15: Canteen updated** (missed since Oct 10): `arc-canteen update product` (Oct 11–15 work, compare 676ef63...5afea74) and `update traction` (external 0; 26 ERP companies emailed Oct 14, 3 detailed replies; only Brian Pond named, with his permission). Post the next pair at the re-submission on Oct 16.
- **Oct 15, 11:30 check:** the site still said "Odoo 19 / ERPNext 15" and old test counts on the home page, nav, /docs and /books: now Odoo 16–19 and ERPNext 15–16, 37 and 29 tests, and a Codespaces link on /docs (live ea5c075). Demo org 0x2cE9… has 1.75 USDC, budget 9.75; local Odoo 19 is connected, Northwind invited, INV-2041 and INV-2042 in draft.
- **Oct 14 evening: usable in one call (T42).** Odoo 16–19 and ERPNext 15–16 supported and tested; "Run the agent now"; funds checked before a bill is sent; a payer can't prove their own wallet as a supplier. A test copy on a lead's version: `ODOO_VERSION=17 ./run.sh up` (port 18017) or `ERPNEXT_VERSION=16 ./run.sh up` (port 18086); `pnpm demo-kit` connects it to a sandbox org with no wallet (the local Odoo 19 demo already is: org 0x2cE9…, key in `.sendsure-demo.json`). Leads without Docker: the Codespaces links in the README.
- **Oct 14: mentor feedback → new pitch (T41).** Video must be ≤60 s with one real example (the Quanta Computer case) and the co-sign + Claude check up front. ERP outreach to 17 companies sent from Pankaj's Gmail (private `the-pick/09-ERP-LEADS.md`); replies are answered hourly. Done the same day: home page (T41), the 60-second video, a demo supplier + two bills in the local Odoo, 9 more emails (26 in all). First replies: Mass Labs (security view on Safe), neoservice.ai (Swiss SMEs pay by bank; "verifying the payee once ... makes sense"). Oct 16: re-render with fresh numbers, `pnpm evidence`, submit.
- **Oct 11, night: product ready for traction** (T39 fixes from filming, T40 contractor emails). Left for Pankaj:
  outreach (P4), Canteen questions (P3), Luma (P2), Circle marketplace (P8), the form (S1, S5). Left for Claude,
  for the re-submission on Oct 16–17: re-render the submission video with fresh numbers (S4, passkey scene
  done Oct 11) and `pnpm evidence` at the freeze (S3). Optional: T14d (needs Circle Console keys).
- **Oct 11: Pankaj asked to keep building until ~Oct 15** (submission work in the last two days): platform
  working perfectly, Odoo perfect, and what competing teams have that we lack (T34+). Claude now goes through
  the Anthropic API directly (`ANTHROPIC_API_KEY`, Worker secret); the MeshAPI code is kept, commented out.
  Form answers and the traction plan are in his private `the-pick/` folder; re-render the submission video
  with `sendsure-video/make-submission.sh` before submitting.
- **Before outreach (Sep 29):** done by Claude: gas keys topped up (relayer and server agent ~9.5 USDC; `/status`
  shows LOW under 2), contact link on every page (`NEXT_PUBLIC_CONTACT_URL`, GitHub Issues until Pankaj picks an
  email/Telegram), `/data` (what is stored where), Pankaj's MetaMask `0xF84a…a194` in `FIRST_PARTY_ADDRESSES`
  (Worker secret + `.env.local`), judges' tour in the README, private outreach kit in `the-pick/03-OUTREACH-KIT.md`.
  **Waiting on Pankaj's laptop:** finish the MetaMask run on `/org` (connect worked; next popups: create org,
  budget, invites/sign-in) and `/verify` with a second MetaMask account (the owner can't be their own payee).
  Test on the live site or on `localhost:3100` (not `127.0.0.1`: `next dev` blocks its scripts there).
- **Next task:** the first ⬜ in [Tasks](#tasks), in order, skipping tasks blocked on Pankaj:
  T14d waits for the Circle Console keys (P5). `MESH_API_KEY` arrived Sep 29 (in `.env.local` and the
  Worker's secrets).
- **Live:** https://sendsure.0xpankaj.workers.dev (Cloudflare Workers on Pankaj's account, OpenNext; D1 `sendsure`).
  Deploy: `pnpm --filter @sendsure/web cf:deploy`. Worker secrets (Cloudflare, never in git): `RELAYER_PRIVATE_KEY`,
  `AGENT_PRIVATE_KEY`, `SESSION_SECRET`, `ARC_RPC_URL` (the arc-canteen RPC with Pankaj's token: Arc's public RPC
  rate-limits Cloudflare's shared IPs). Upload them with `wrangler secret bulk` from `.env.local`, never echoed.
- **Repo:** https://github.com/0x-pankaj/sendsure (public, MIT).
- **Hackathon-only diff:** https://github.com/0x-pankaj/sendsure/compare/tameion-baseline...main
- **Chain:** Arc testnet, chain id `5042002`. RPC `https://rpc.testnet.arc.io` (Arc moved its docs and RPC to arc.io; the old `rpc.testnet.arc.network` host is gone). The server uses it as `ARC_RPC_URL` since Oct 17: the Canteen RPC answered reads but could not relay transactions ("all transaction relay upstreams are unreachable").
  USDC `0x3600000000000000000000000000000000000000` (6 decimals). EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`.
- **Deployed addresses:** [`deployments/arc-testnet.json`](deployments/arc-testnet.json).
- **Run locally:** `pnpm install && pnpm gen && pnpm typecheck && pnpm test`; web app:
  `pnpm --filter @sendsure/web dev`. The server needs `apps/web/.env.local` (gitignored):
  `RELAYER_PRIVATE_KEY` (pays gas, no role; `0x1B66…8b73`) and `AGENT_PRIVATE_KEY` (the SendSure server
  agent `0xdE71…3E30`, = `FALLBACK_AGENT` in `contracts/.env`). Live checks against a running server:
  `pnpm e2e:bind|e2e:change|e2e:org --base http://127.0.0.1:3100`. Stop a local server by its PID, never `pkill -f <pattern>`
  (the pattern also matches the shell running it).
- **Circle agent wallet** (Circle CLI, testnet session, owner Pankaj): `0x9f977c4efff254a9284e69a0ae2b03e4ab851c07`.
- **Private strategy, not in this repo:** competitor analysis, outreach lists and the pre-build review
  live in Pankaj's local `the-pick/` folder. Never copy them here.

## What we're building

SendSure is a payables agent for teams that pay contractors in stablecoins. It pays only a payee who
proved their own address, only for a claim that payee signed, and only inside a budget an Arc contract
enforces. Then it writes each payment into the books the team already keeps.

**Traction unit:** the *payout check*. A payer checks their real payout list before sending it; each
row is compared with the address they paid last time and with the payee's own proof. No contractor
action is needed. The same run is then rehearsed on Arc testnet under the contract's rules.

## Working agreement (every session)

1. **One task at a time.** Finish it: tests pass, then commit, then push, then tick it here, all in the
   same commit.
2. **After each milestone (M1–M6),** post `arc-canteen update product`.
   - Keep it short and factual, and include the commit link.
   - Pipe it in as lines with no blank lines: `printf '%s\n' "line" "line" "" | arc-canteen update product`.
3. **Traction updates only report real people.** Use `arc-canteen update traction` only for real
   contacts or users, and label first-party vs external. Sandbox or demo activity never counts.
4. **Secrets never go in git.** Keys live in `.env` (gitignored) or the host's secret store.
5. **Testnet by default.** The live site, the demo and every test run on Arc testnet. The **mainnet beta**
   (branch `mainnet`, Worker `sendsure-mainnet`, Oct 17, asked for by Pankaj for the Arc OSS mainnet bounty) is
   real money: contracts not audited, at most 10 USDC a bill (enforced at org creation and before every settle),
   fresh keys only (never the testnet ones), no faucet, no test wallets, no passkeys, no x402. Traction there counts
   only real outside users, never our own wallets.
6. **Claims must be true and provable.** Never say "stablecoins have nothing like this". Claim the
   combination, and link a tx or a test for every claim.
7. **When scope and traction conflict, traction wins.** See the kill switch.

## Milestones

| # | Milestone | Target date | Proof |
|---|---|---|---|
| M1 | Contracts built and tested | Tue Sep 29 | 47 tests green ✅ |
| M2 | Contracts live on Arc testnet, first real settle | Tue Sep 29 | explorer links ✅ ([smoke test](deployments/smoke-test.md)) |
| M3 | Payout check + payee verify page live on a URL | Wed Sep 30 | live URL ✅ https://sendsure.0xpankaj.workers.dev (Sep 29) |
| M4 | **Must-work demo, hosted:** payee binds → signs claim → agent proposes run with dry run + reasons → approver co-signs → agent wallet settles → receipt + beancount entry → dashboard counts it; a wallet-change attempt is refused | Thu Oct 1 | live URL + tx ✅ Sep 29 ([agent](deployments/agent-e2e.json), [circle](deployments/circle-e2e.json), [change](deployments/relay-e2e-change.json), [books](deployments/books-e2e.beancount)). Model reasons join when `MESH_API_KEY` lands (T14b) |
| M5 | Agent judgment on messy input + MCP + judge path `/try` + first Loom + first form submission | Sat Oct 3 | Loom, form. Code part ✅ Sep 29: Claude live in the agent (T14b), invoice reading (T13b, also checked in a real browser: payer reads, payee signs), judgment inbox (T21), MCP (T20), `/try` (T17); all 8 e2e suites pass live (74 checks). Left: Loom + form (S1) |
| M6 | Final: README in house style, video under 3 minutes, evidence folder, numbers frozen at Oct 10 23:59 ET | Sat Oct 10 | submitted |

Deadline: **Sat Oct 10, 11:59 PM ET = Sun Oct 11, 09:44 Kathmandu.** Submit by Sat Oct 10 evening.

## Tasks

Owner **C** = Claude, **P** = Pankaj. "Done when" is the definition of done.

### Contracts
| ID | Task | Owner | Done when | Status |
|---|---|---|---|---|
| T1 | Baseline commit + `tameion-baseline` tag + BASELINE.md | C | tag pushed, diff link works | ✅ |
| T2 | Audit the pre-window spike (6 exploit tests) | C | `prior-work/horos-spike/AUDIT.md` | ✅ |
| T3 | PayeeRegistry + Mandate + MandateFactory | C | compiles, `contracts/README.md` | ✅ |
| T4 | Tests: 30 Mandate + 14 registry + 3 invariants | C | `forge test` green | ✅ |
| T5 | Pre-deploy self-review of the contracts (checklist below) | C | findings fixed or written down | ✅ |
| T6 | Deploy PayeeRegistry + MandateFactory to Arc testnet, `setFactory`, verify source on the explorer | C | `deployments/arc-testnet.json` + explorer links | ✅ |
| T7 | Live smoke test on Arc testnet, labelled first-party: org → slot → bind → claim → co-sign → settle | C | tx hashes in `deployments/smoke-test.md` | ✅ |

### App (web + worker)
| ID | Task | Owner | Done when | Status |
|---|---|---|---|---|
| T8 | Monorepo scaffold: pnpm workspaces, TypeScript, `packages/chain` (viem, generated ABIs + addresses, EIP-712 types, claim helpers) | C | typecheck + 6 tests green, incl. live cross-checks against the deployed contracts | ✅ |
| T9 | **Payout check** (in browser, nothing leaves the machine): load payout CSV + last-paid export → SAME AS LAST PAID / CHANGED / NEW / LOOKALIKE + registry status per row → checked list export | C | works on a sample file (`apps/web/app/check`, logic in `packages/core`, try `/check?example`); 14 unit tests | ✅ |
| T10 | Payee verify page: connect wallet, switch to Arc testnet, sign `Bind` (plain-language message), relayer submits `bindWithSig` | C | a real EOA binds on testnet: fresh EOA via `pnpm e2e:bind` ([run](deployments/relay-e2e.json): forged sig and replay refused), and the page itself with the in-browser test wallet. A MetaMask run by a real payee is still to come (P4) | ✅ |
| T11 | Relayer service (gas paid by a funded relayer key; rate-limited) | C | relays bind + change: `pnpm e2e:change` ([run](deployments/relay-e2e-change.json): attacker's change and re-bind refused, both-key change waits 24 h, replay refused, payer cancels) + change UI on `/verify` | ✅ |
| T12 | Payer onboarding: create Mandate via factory (owner and treasury = payer's own wallet), set caps, approve a capped allowance, open slots, send invites | C | a payer org is created from the UI: `/org` with a test wallet (create → budget → 3 invites, all gasless). `pnpm e2e:org` ([run](deployments/org-e2e.json)): org in someone else's name refused, stranger's invites refused, replay refused, payee binds. Test-wallet orgs are tier SANDBOX | ✅ |
| T13 | Claims: the payee signs a claim on their page (invoice no., amount, work period); the server keeps each org's secret ref salt, runs the contract's own `check()` and stores it; payer and payee see their claims (wallet sign-in) | C | claim stored and signed: `pnpm e2e:claim` ([run](deployments/claim-e2e.json)): stored as ESCALATED (first payment needs a co-sign); same invoice typed differently, another key's signature and a mismatched invoice no. refused; a stranger can't list claims. Also sent from `/verify` in the browser | ✅ |
| T13b | Invoice extraction: payer uploads an invoice → AI via **MeshAPI** (pass 1: every field with a verbatim quote, checked against the text in code; pass 2: strict JSON schema) → payee confirms by signing | C | `/org` "Add an invoice" (text or photo) → `/verify` "Use this invoice" / "Not mine". Live `e2e:invoice` 12/12 ([run](deployments/invoice-e2e.json)): messy text and a photo read by Opus 5.5; the "we changed banks, pay this wallet" line reported and warned about first (it also spotted the burn address); quotes checked word for word; the payee signs one, rejects one; a re-read warns "already claimed" | ✅ |
| T14 | Agent run: open claims → `check()` → planner (rules first; then Claude **via MeshAPI**, tool-only strict JSON: it can hold or escalate, never add payees or change amounts) → proposal with reasons → approver co-signs ESCALATED claims in `/org` (wallet tx) → agent settles PAYABLE ones with `settle(claim, sig, decisionHash)`. Executors: Worker = server agent key, or a Circle developer-controlled wallet once P5 keys exist; local runner = Circle CLI agent wallet | C | one full run on testnet with reasons: `pnpm e2e:agent` live ([run](deployments/agent-e2e.json)): escalate → co-sign → Settled with the decision hash → payee paid; a "pay my new wallet, urgent" claim that passes the contract is held with reasons. `/org` has "Run the agent" + co-sign | ✅ |
| T14b | The model in the loop, live: Claude via MeshAPI reviews each run with read-only tools (`dry_run`, `payee_history`); code in `lib/agent.ts` + `lib/llm.ts` | C | a live run shows the model's reasons: `EXPECT_MODEL=1 pnpm e2e:agent` live 11/11 ([run](deployments/agent-e2e.json)), planner "rules + anthropic/claude-opus-5.5 via MeshAPI" (Sonnet 5 fallback; picked after a side-by-side test: Opus 5.5 was faster, plainer and spotted the burn address) | ✅ |
| T14c | Circle agent wallet as the executor: `pnpm agent:circle --org 0x…` signs in as the Circle agent wallet (ERC-1271), gets a plan-only run, sends `settle()` and `anchor()` with `circle wallet execute`; the server records each tx only after reading it from the chain | C | `pnpm e2e:circle` live ([run](deployments/circle-e2e.json)): the Circle agent wallet settled a claim (Settled with the decision hash, payee +0.2 USDC) and anchored the log; replay verified | ✅ |
| T14d | Hosted Circle executor: the Worker settles through a Circle developer-controlled wallet (REST contract execution, entity secret) so no laptop is needed | C | a hosted settle sent by a Circle wallet (needs P5 Circle keys) | ⬜ |
| T15 | Decision log in D1: hash-chained records (inputs, check() results, planner output, executor), `decisionHash` passed to `settle()`, head anchored with `Mandate.anchor`; `replay <id>` re-checks signatures + `check()` at the recorded block (never re-asks the model) | C | replay works: `GET /api/agent/replay` live — chain, payee signature, `check()` at the recorded block, payment event and anchor all verified in `e2e:agent` | ✅ |
| T16 | Indexer (events → D1, ≤ 9,999-block windows, cursor; a Worker cron every minute via `apps/web/worker.ts`, plus lazily on reads) + receipts + `/status` + dashboard with three tiers (external / first-party / sandbox excluded) | C | dashboard shows real tx: [/dashboard](https://sendsure.0xpankaj.workers.dev/dashboard) (today: 0 external, 0 first-party, 16 sandbox orgs; 6 sandbox payments), [/receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0xcfbb0de697f5a1349997b798de2443e358844ad39b47eb26a36553bd3128e89e) (only factory-made orgs count), [/status](https://sendsure.0xpankaj.workers.dev/status). Add your own wallet to `FIRST_PARTY_ADDRESSES` before demoing with it | ✅ |
| T17 | Sandbox org (tier SANDBOX) + `/try` judge path with no wallet: look-alike refusal via `check()`, recorded refusal tx, public verify lookup | C | `/try` works logged out: [/try](https://sendsure.0xpankaj.workers.dev/try) on demo org `0xf532…E339` (keys derived per visitor from `DEMO_SECRET`, never stored; steps restored on reload; a refresh never pays twice). `pnpm e2e:try` live 9/9 ([run](deployments/try-e2e.json)): payee binds, payout check flags the look-alike, attacker's claim refused on-chain (BAD_SIGNATURE), wallet change refused, escalate → co-sign → paid, receipt, public lookup | ✅ |
| T18 | Hosting: always-on host, database, domain + TLS, secrets in the host store, `/status` page | C+P | live URL ✅ Cloudflare Workers + D1 (Pankaj's choice; Hono split only if Workers limits bite). All 4 e2e suites pass against the live URL (31/31). Left: domain (P1), `/status` (with T16) | ✅ |
| T19 | Books: beancount writer (6 decimals, explicit tolerance, balance assertion from chain) + `bean-check` | C | sample ledger passes: `packages/core/src/beancount.ts`; `/org` → "Download books"; live ledger from `e2e:agent` passes `bean-check` ([file](deployments/books-e2e.beancount): the co-sign's gas shows up as an outside movement, the closing balance is read from the chain) | ✅ |
| T20 | MCP server on the sandbox org only: `dry_run` by default, idempotency signal on every tool, rate limits | C | a judge's Claude can call it: `claude mcp add --transport http sendsure https://sendsure.0xpankaj.workers.dev/api/mcp`. Tools: `check_payout_list`, `verify_payee_address`, `get_payment_receipt`, `get_sendsure_stats` (read-only), `run_demo_scene` (sandbox only, dry run by default, idempotent). Checked with the official MCP Inspector CLI (tools/list, tools/call) and a real scene + replay | ✅ |
| T21 | Agent judgment inbox: duplicate invoice under a new number, claim missing evidence, look-alike "new wallet" email with a hidden instruction → reasons shown, `settle()` refuses | C | demo scene recorded: `/try` step 5 and MCP `run_demo_scene inbox`; live `e2e:try` 10/10 ([run](deployments/try-e2e.json)): Claude holds the duplicate ("would pay twice"), escalates the undescribed claim and the hidden-instruction "new wallet" request; none paid; the page states that even a fooled agent could only pay the proven address | ✅ |
| T22 | Paid checks for other agents: x402 over **Circle Gateway Nanopayments** (`@circle-fin/x402-batching`'s facilitator, Web-standard handler in `lib/x402.ts`): `POST /api/x402/verify-payee` $0.001, `POST /api/x402/check-payout` $0.005, catalog `GET /api/x402`; the check runs before the charge; payments in D1 `x402_payments` and on the dashboard (first-party vs external payers) | C | `pnpm e2e:x402` live 11/11 ([run](deployments/x402-e2e.json)): unpaid 402 accepts Arc testnet via Gateway, `circle services inspect` payable, estimate, the Circle agent wallet (1 USDC deposited to Gateway on Arc testnet) pays both, Gateway settles, dashboard counts them. Marketplace listing: submission via agents.circle.com "Talk to us" (P8) | ✅ |
| T23 | Odoo, SendSure side: org **integration keys** (owner/approver creates one in `/org`, shown once, stored as a SHA-256 hash, revocable) + a key-only API `/api/v1/*`: `org` (test connection), `payees` (state and proven address per invite ref), `verify` (is this address proven), `bills` (POST a posted vendor bill as a proposal, idempotent per Odoo bill; GET each bill's status down to the settle tx), `agent/run` (the agent pays only what passes the contract; a key can never approve or co-sign). A claim confirming a proposal must match its amount | C | done Sep 29: `integrations.test.ts` (bill parsing, hashed keys, revoked keys refused), deployed; a co-signed claim reads as `signed` so Odoo asks for a run only then; key runs have their own rate budget. `/org` has "Connect your books" | ✅ |
| T24 | Odoo addon `integrations/odoo/sendsure_payables` (Odoo 19 Community, LGPL-3), built on the prior-work repro: USDC as currency `USC` (6 decimals, rate 1), a "USDC on Arc (SendSure)" journal and payment method that **needs a trusted wallet** (Odoo's own `allow_out_payment`, off in Community); vendors linked to a SendSure invite; trusting a wallet is refused unless SendSure says the vendor proved it; "Pay with SendSure" on a posted bill; a cron syncs states, asks the agent to run, and records each settlement through Odoo's Register Payment with the exact on-chain amount and the tx in the memo; any amount that is not exact (the half-cent Odoo would swallow) is left open for review, never rounded | C | done Sep 29: 14 Odoo tests pass (`integrations/odoo/run.sh test`); `pnpm e2e:odoo` live 25/25 ([run](deployments/odoo-e2e.json)): slipped-in wallet refused even for the admin, agent user can't trust, bill → vendor signs (wrong amount refused) → cron: needs co-sign → owner co-signs → next cron: paid on Arc → recorded via Register Payment, 0.25 USDC exact, tx in memo, once. Screenshots in `integrations/odoo/docs/`. Found live: an agent run can outlast a 25 s read timeout, so runs get 150 s and Odoo always re-reads status after | ✅ |
| T25 | Books in more formats: hledger journal, journal CSV, statement CSV next to beancount, all built from one list of movements (`packages/core/src/ledgers.ts`); four-format download in `/org` and `/try` | C | ✅ Sep 30: 6 tests; `hledger check --strict` and `bean-check` pass on the sample and on the live demo org's books; hledger refuses a balance off by 0.000001 | ✅ |
| T26 | `/books` page (what is enforced, Odoo screenshots, every format, sample download from the demo org) + new landing page (real receipt in the hero, failure modes, who it is for) + `ROADMAP.md` | C | ✅ Sep 30: live; fits a 390 px screen | ✅ |
| T27 | Agent: **cash plan** (`lib/cash.ts`: when the claims to pay do not fit in min(balance, allowance), oldest work first, the rest is held with the amount short) + **autopilot** (`lib/autopilot.ts`, migration 0008: owner opt-in; the cron reads each open claim's `check()`, co-sign and the funds, and runs the agent only when something changed; 2-minute floor, 60 runs a day) | C | ✅ Sep 30: live run `pnpm e2e:autopilot` 9/9 ([record](deployments/autopilot-e2e.json)): every run started by the cron; `e2e:agent` 13/13 after the change; dashboard counts agent runs and autopilot runs per tier | ✅ |
| T28 | ERPNext app `integrations/erpnext` with the Odoo add-on's guarantees, tests inside ERPNext, live run `pnpm e2e:erpnext` | C | ✅ Sep 30: 25 tests inside ERPNext 15.121.6, live run 29/29 ([record](deployments/erpnext-e2e.json)), reviewed and re-run by the main session; `/api/v1/bills` now accepts `system: "erpnext"` | ✅ |
| T29 | Traction-ready (Oct 2): payee phone path on `/verify` (Open in MetaMask / copy link; no test wallet on a real payer's invite), "Get set up" lead form on `/check`, `/try`, `/org` (D1 `leads`; `scripts/leads.sh`; optional `LEADS_WEBHOOK_URL` ping), org notifications to Discord/Slack (new claim, co-sign waiting, paid; `lib/notify.ts`), anonymous usage counts on the dashboard, contact link = Telegram | C | ✅ live; 38 web tests. Also: /check accepts Stellar (checksum), bech32 (Cosmos, dYdX, bc1) and SS58 addresses | ✅ |
| T30 | Browser-wallet e2e (`scripts/e2e-wallet.ts`, Playwright + a MetaMask-style injected wallet) on the live site: payer and payee flows, network add/switch, permit, co-sign tx, payment, receipt, org recovery on a new browser. Found and fixed: claims list now opens after an agent run (co-sign button was hidden behind "Show claims"); stale "run the agent" hint on paid claims | C | ✅ Oct 3: 14/14 ([record](deployments/wallet-e2e.json)) | ✅ |
| T31 | Odoo hardening after a code review: cancel/reset/delete withdraws the bill from SendSure (`POST /api/v1/bills/withdraw`; refused once paid), no Register Payment while in flight, per-bill savepoints in the cron, manager "Record SendSure payment" for needs-review (states exactly what Odoo rounds away), safe list sending, Arc tx field writable only by SendSure's own recording, payments with a tx cannot be reset, trust checked on create, stray/archived/relinked wallets untrusted, API methods `@api.private` + accounting-users only, method mode `unique`, USC rate kept at USD for non-USD companies, cron `noupdate` | C | ✅ Oct 3: 28 Odoo tests; live 27/27 | ✅ |
| T32 | Ready for real users on testnet (Oct 10): built-in testnet faucet in `/org` (2 test USDC once per signed-in wallet; 3 per network a day; 60 a day in total; `lib/faucet.ts`, migration 0010, faucet key with no contract role, balance on `/status`), rate limits keyed on `cf-connecting-ip` (X-Forwarded-For could be spoofed) | C | ✅ live; `pnpm e2e:faucet` 4/4 | ✅ |
| T33 | Final for submission (Oct 10): owner signatures for create-org and invites are claimed in D1 (`used_signatures`, migration 0011) before the relayer acts, so a replay is refused on every Worker instance and a replayed invites signature can't re-open a revoked invite; invoice reading answers 503 `MODEL_UNAVAILABLE` when the model provider is down or out of credit; the chain test reads the smoke test's Settled event by block (the public RPC no longer finds old transactions by hash) | C | ✅ live; `pnpm e2e:org` 10/10; all 14 live suites re-run Oct 10 (agent and invoice model checks wait for MeshAPI credit) | ✅ |
| T34 | Claude through the Anthropic API directly (MeshAPI code commented out, `toAnthropic`/`fromAnthropic` in `lib/llm.ts`, 6 tests); autopilot keeps why a check failed (migration 0012), shows it on `/org`, retries in 2 minutes backing off to 30 | C | ✅ live Oct 11: agent 13/13, invoice 12/12, try 10/10, autopilot 9/9 with Claude Opus 5.5 | ✅ |
| T35 | Odoo: "Email the invite" (Odoo's composer, template with the vendor's own link), the invite link with a copy button, "Co-sign in SendSure" / "Open in SendSure" on bills, bill-list filters and group-by on SendSure status | C | ✅ 30 Odoo tests; live `pnpm e2e:odoo` 27/27 | ✅ |
| T36 | Competitor gaps (research Oct 11: Vestiarion, Custara, Steward, CeedeBooks, Symbolon…): `/check` shadow review (Claude reviews a real payout run, can only be stricter, agree/disagree counts on the dashboard); "How the agent decided" on `/dashboard` (agreed / more careful / overruled, per tier) | C | ✅ live; 54 web tests | ✅ |
| T37 | Passkey payees (no wallet app): Circle Modular Wallets smart account on `/verify` binds with `bind()` and claims with `submitClaim()` (gas from Circle Gas Station), server takes `onchain: true` claims, replay checks `submittedBy`; a panel to send the USDC out | C | ✅ live Oct 11: `pnpm e2e:passkey` 7/7 in a real browser (virtual passkey): wallet created, bound with Gas Station, claim sent on-chain, paid 0.2 USDC, 0.1 sent out; `pnpm e2e:onchain-claim` 8/8 | ✅ |
| T38 | `/docs`: the whole product in plain words for anyone we send a link to (problem, the three rules, how a payment moves, every part, who can move money, attacks, step-by-step guides per role with anchors such as `/docs#payee`, Circle and Arc, proof, FAQ, glossary, contracts); "Docs" in the header, "How it works" in the footer; tables become cards on phones | C | ✅ Oct 11, checked at 1366/1100/990/820/390 px with no sideways scroll |
| T39 | Fixes found while filming the walkthrough (Oct 11): a passkey claim is left with SendSure (checked, `intent: true`, migration 0013 `claim_intents`) before it goes on Arc, and is recorded from there by the cron, the payee's claim list or the next prepare once `submittedBy` shows it sent, so a page closed between `submitClaim()` and the POST no longer holds the invoice number unseen (`RefInUse`); an invoice number held on Arc by an unknown claim answers `REF_HELD_ON_ARC` before sending; resubmitting a stored claim returns the same answer. Odoo/ERPNext bills that Claude asked a person about (escalate on a claim the contract would pay) now say "Needs a co-sign", as SendSure does (`waitingFor()` in `lib/integrations.ts`), not "Held". "Open in MetaMask" on `/verify` was dark text on navy. Also: commit d75bf73 (co-sign button for claims Claude *held* that the contract would pay) is right, but its message gave the wrong reason: the filmed bill was an escalate, which already had the button | C | ✅ live Oct 11 (migration 0013 applied): `e2e:onchain-claim` 13/13, `e2e:passkey` 7/7 (real browser, new page flow), `e2e:odoo` 27/27; local `e2e:claim` 11/11, `e2e:invoice` 12/12; 56 web tests | ✅ |
| T40 | Ready for traction (Oct 11): a contractor was never told that a bill waits for their signature (SendSure keeps no contact details, Odoo sent nothing). Odoo bills waiting for the vendor get **Email the vendor to sign** (Odoo's composer, template with the invoice number, amount and the vendor's own link); the invite email, `/verify` and `/docs` say "keep this link: each invoice shows up here" | C | ✅ 31 Odoo tests (new: the bill email carries the vendor's link and the exact invoice); `/docs` and `/verify` live | ✅ |
| T41 | Pitch after mentor feedback (Oct 14): lead with the fake supplier and the "we changed our bank details" email, not address typos (autofill makes those rare). Home page: hero and problem section now open with the Quanta Computer case (Google and Facebook paid over $100M to a fake supplier; sourced), then the three defences: payout change needs both keys, a fake supplier can't sign from the proven wallet and a new supplier's first payment waits for a co-sign, Claude checks every bill (double billing, amounts far above normal, notes asking to hurry or change wallets). Claude never sees supplier names (they stay in the payer's browser), so nothing claims it spots look-alike names. 60-second video on the same story: `sendsure-video/make-sixty.sh` → `out/sendsure-60s.mp4` (0:58, -15 LUFS); scene 4 is Claude's real decision from a sandbox run (contract: PAYABLE; Claude: ask a person, "more than twice what this payee has been paid before, and it pressures you to pay today") | C | home page live (124baaa); video rendered | ✅ |
| T42 | Usable in one call (Oct 14): most leads run Odoo 16–18 or ERPNext 16, and the review of payer and vendor onboarding found traps that would end a 15-minute call. **Odoo add-on now installs on 16, 17, 18 and 19** from one source (`models/compat.py`; Odoo 16's views are built by `integrations/odoo/build16.py` into `16.0/`); manifest version `1.2.0` (Odoo 18+ refuse `19.0.x`); `ODOO_VERSION=17 ./run.sh up|test`. **ERPNext app runs on 15 and 16** (`ERPNEXT_VERSION=16 ./run.sh up|test`). "Run the agent now" on a signed Odoo bill (no 5-minute wait). "Pay with SendSure" in both add-ons refuses a bill over the org's per-bill cap or beyond its balance and budget, before the vendor signs (Arc refuses such a claim for good); "Test connection" shows balance, budget and caps (`/api/v1/org` returns `funds`). `/verify` and the bind relay refuse to prove one of the org's own wallets as a payout (the payer trying their own invite; it could never be paid, and undoing a bind takes a day). Create-org and budget relays each get 10 tries an hour instead of sharing 3. ERPNext: companies whose books are in another currency (CHF, EUR, INR) can pay USD invoices too (USDC account for every company; the payment is valued at the invoice's USD rate on both sides). `pnpm demo-kit`: one command from a test Odoo to a connected SANDBOX payer org (no wallet: relayer gas, faucet USDC, budget, books key, vendor invite), `pnpm demo-kit cosign` for the owner's co-sign; Codespaces configs (`.devcontainer/`, Odoo 16–19) for leads with no Docker or on Odoo Online | C | live rehearsal with the kit on Arc testnet: vendor proved → bill sent → signed → co-signed → "Run the agent now" → paid and recorded in Odoo (tx 0xc8eb594e…); again through the real screens in Chrome: vendor proved and signed on /verify (sandbox test wallet), Odoo "Check with SendSure", trusted, "Pay with SendSure", kit co-sign, "Run the agent now" → PAID 0.15 USDC (tx 0xf753a01a…); kit also run against an Odoo 17 copy started like a Codespace; a real Codespace (Odoo 17 config) was created from the README link and its Odoo port forwarded; the same `.devcontainer` was then built with the Dev Containers CLI from a clean clone and a fresh lead's whole path ran inside it on Odoo 17: demo-kit (new org, faucet) → vendor proved → bill sent → signed → kit co-sign → "Run the agent now" → paid on Arc, recorded in Odoo (tx 0xc33d1f2c…). It caught one bug: `corepack enable` needs sudo for the node user (fixed). After the fix, a real Codespace from the README's Odoo 17 link came up serving Odoo 17.0 with database sendsure17 on its forwarded port (setup and start commands both ran); the broken first Codespace was deleted; clean `pnpm install` on Node 22 checked; Odoo tests 37/37 on 16, 17, 18, 19; ERPNext 29/29 on 15 and 16; web 57/57, chain org 7/7, typecheck clean | ✅ |
| P6 | Circle Console client key for Modular Wallets, passkey domain `sendsure.0xpankaj.workers.dev` → build var `NEXT_PUBLIC_CIRCLE_CLIENT_KEY` in `apps/web/.env.local` | P | ✅ Oct 11 (client key `sendsure-web`, passkey domain set, Arc Testnet gas policy active by default) | ✅ |

### Traction (every day, 2 hours)
| ID | Task | Owner | Done when | Status |
|---|---|---|---|---|
| P1 | Buy the domain (sendsure.com or sendsure.xyz) and tell Claude | P | domain bought. **Oct 11: Pankaj said no domain for now**; the workers.dev URL is the submission URL | — |
| P2 | Confirm the Luma registration; use GitHub `0x-pankaj` (with the hyphen) everywhere | P | confirmed | ⬜ |
| P3 | Organizer questions in a public Canteen channel: does a testnet rehearsal / payout check count as a business onboarded; the event_name; a test-USDC grant; ask for 2–3 intros | P | posted | ⬜ |
| P4 | Outreach: 30–40 named teams that pay contractors in stablecoins, ranked by next real payout date; 10 personal messages a day, follow-ups at 24 h and 72 h, never bulk | P | Sep 29: 30+ sent, 6+ calls; Oct 1: 3+ orgs active | ⬜ |
| P5 | Keys: **MeshAPI key** (`MESH_API_KEY=rsk_…`, for all AI) and a Circle Console TEST API key + entity secret (sandbox treasury), written into `apps/web/.env.local` yourself (never in chat) | P | in `.env.local`. **Oct 11: MeshAPI part superseded** (Claude through the Anthropic API). The Circle Console key + entity secret are only for T14d (optional) | ⬜ |
| P6 | Sep 30 beancount fireside: confirm time/link; bring the six-decimal tolerance question | P | attended. Date passed (Sep 30); not tracked here | — |
| P8 | Circle marketplace: submit SendSure's paid checks through agents.circle.com/services → "Talk to us" (metadata in `deployments/x402-listing.md`) | P | submitted | ⬜ |
| P7 | Hosting account: Cloudflare, Pankaj's own (he chose Workers on Sep 29: "if not work then split backend with hono") | P | confirmed | ✅ |

### Submission
| ID | Task | Owner | Done when | Status |
|---|---|---|---|---|
| S1 | First Loom (60–90 s) + first form submission with repo + diff link | C+P | submitted (target Sat Oct 3). Answers ready in the private `07-SUBMISSION.md` (updated Oct 11 with passkey payees and current test counts); the form allows re-submitting, so submit now and again on Oct 16–17 | ⬜ |
| S2 | README in house style: "X does Y, here is the file"; Circle surfaces table with a proof column; prior art and what's different; threat model; "who can move money" matrix | C | reviewed: drafted Sep 29 with every claim linked to a file, test or live run; Pankaj to read it once. Update the numbers at the freeze | ✅ |
| S3 | Evidence folder: traction.json (every counted org, run, settle with tx), redacted decision log, anchor txs; nightly DB backup off-host | C | committed at the freeze. **Ready Oct 11:** `pnpm evidence` writes [`deployments/evidence/`](deployments/evidence/) from the public `/api/stats/evidence` (every external and first-party org, proven payee, payment, co-sign and anchored head with its tx; sandbox only counted); D1 Time Travel keeps 30 days of restores. Re-run and commit at the freeze | ⬜ |
| S4 | Final video: 4–5 scenes, at most 2:45, captions, sandbox scenes labelled | C+P | uploaded. Oct 11: the 9-minute walkthrough (`sendsure-video/out/sendsure-walkthrough.mp4`) and the 66-second promo exist; the submission video (`out/sendsure-submission.mp4`, 2:55, under the form's 3:00) now shows Circle passkey wallets and current test counts; re-render with fresh numbers (`./make-submission.sh`) for the re-submission | ⬜ |
| S5 | Final submission + final `arc-canteen update product` and `update traction`; re-login the Circle CLI on Oct 10 | P | submitted by Oct 10 evening | ⬜ |

## Deferred: only if ahead after Mon Oct 5
Onramp "Add funds" · Earn/USYC · cross-chain payouts via CCTP ·
hosted Odoo (show a video + docker compose instead) · ERPNext issue · more CSV formats · passkey payee UI
(the contract already supports `bind()` from a smart account).

## Kill switch
- **Tue Sep 29 (today):** by tonight, 30+ messages sent, 6+ calls booked, 1+ org activated. If not,
  switch to intro-first outreach and cut scope further.
- **Thu Oct 1:** 3+ orgs active, or cut everything in *Deferred* and spend the extra time onboarding.
- **Any new idea after Wed Oct 7:** refuse it. The last days are for packaging.

## Locked decisions
- **Name:** SendSure.
- **AI:** model calls go to Claude through the **Anthropic API** directly (`lib/llm.ts`; Opus 5.5, Sonnet 5.5 fallback). Said by Pankaj, Oct 11: comment the MeshAPI code out, do not remove it. (Sep 29–Oct 10 it was MeshAPI, `https://api.meshapi.ai/v1`.)
- **Hosting:** **Cloudflare Workers** (OpenNext) on Pankaj's account. If Workers limits ever bite, split the API into a
  Hono Worker and serve the pages statically (Pankaj, Sep 29).
- **Database:** **Cloudflare D1** `sendsure` (ENAM, id `4b2134c8-7d8c-4200-b611-8f521767ca3d`) on Pankaj's account; SQL in `apps/web/migrations`, applied with `npx wrangler d1 migrations apply sendsure --remote`. Local development and tests run the same SQL on node:sqlite. Said by Pankaj, Sep 29.
- **Licence:** MIT; the Odoo add-on is LGPL-3.
- **Testnet only.**
- **No code reused** from earlier events.
- **Money stays in the payer's own wallet;** the contract holds only a capped allowance. A Circle
  developer-controlled treasury is used only for the sandbox and for labelled custodial payers.
- **The approver co-signs the exact claim** (payee, amount, invoice), not just the invoice.
- **ATTESTED (payer-vouched) addresses** always need a co-sign, and that co-sign stands in for the
  payee's signature.
- **First payment to a new or changed address** always needs a co-sign.
- **Caps start at zero.**
- **`settle()` never reverts on a policy failure;** it emits `Refused` / `Escalated` / `AlreadySettled`.

## T5 pre-deploy review checklist (done Sep 29; known limits in `contracts/README.md`)
- [x] Only `settle()` can move tokens; no other `transferFrom` path.
- [x] Every `settle()` precondition also appears in `check()` (same `_evaluate`).
- [x] No owner or agent path can change a bound payout.
- [x] EIP-712 domains include chainId and verifyingContract; nonces are per signer.
- [x] Reentrancy guard on `settle()`; effects happen before the transfer.
- [x] Role separation: agent ≠ approver ≠ payee; owner ≠ agent.
- [x] Events carry no names, invoice numbers or real amounts.
- [x] The clone initializer can't be re-run; the implementation is locked (`_disableInitializers`).
