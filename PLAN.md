# SendSure build plan: the source of truth

> **Any new session starts here.** Read "Resume here", do the next unchecked task, then follow the
> working agreement. This file is updated in the same commit as the work it describes.

## Resume here

- **Status:** see the task table; ✅ = done and pushed.
- **Next task:** the first ⬜ in [Tasks](#tasks), in order.
- **Live:** https://sendsure.0xpankaj.workers.dev (Cloudflare Workers on Pankaj's account, OpenNext; D1 `sendsure`).
  Deploy: `pnpm --filter @sendsure/web cf:deploy`. Worker secrets (Cloudflare, never in git): `RELAYER_PRIVATE_KEY`,
  `AGENT_PRIVATE_KEY`, `SESSION_SECRET`, `ARC_RPC_URL` (the arc-canteen RPC with Pankaj's token: Arc's public RPC
  rate-limits Cloudflare's shared IPs). Upload them with `wrangler secret bulk` from `.env.local`, never echoed.
- **Repo:** https://github.com/0x-pankaj/sendsure (public, MIT).
- **Hackathon-only diff:** https://github.com/0x-pankaj/sendsure/compare/tameion-baseline...main
- **Chain:** Arc testnet, chain id `5042002`. RPC `https://rpc.testnet.arc.network`.
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
5. **Testnet only.** Nothing is ever sent on mainnet.
6. **Claims must be true and provable.** Never say "stablecoins have nothing like this". Claim the
   combination, and link a tx or a test for every claim.
7. **When scope and traction conflict, traction wins.** See the kill switch.

## Milestones

| # | Milestone | Target date | Proof |
|---|---|---|---|
| M1 | Contracts built and tested | Tue Sep 29 | 47 tests green ✅ |
| M2 | Contracts live on Arc testnet, first real settle | Tue Sep 29 | explorer links ✅ ([smoke test](deployments/smoke-test.md)) |
| M3 | Payout check + payee verify page live on a URL | Wed Sep 30 | live URL ✅ https://sendsure.0xpankaj.workers.dev (Sep 29) |
| M4 | **Must-work demo, hosted:** payee binds → signs claim → agent proposes run with dry run + reasons → approver co-signs → agent wallet settles → receipt + beancount entry → dashboard counts it; a wallet-change attempt is refused | Thu Oct 1 | live URL + tx |
| M5 | Agent judgment on messy input + MCP + judge path `/try` + first Loom + first form submission | Sat Oct 3 | Loom, form |
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
| T13b | Invoice extraction: payer uploads an invoice → AI via **MeshAPI** (pass 1: every field with a verbatim quote, checked against the text in code; pass 2: strict JSON schema) → payee confirms by signing | C | needs `MESH_API_KEY` (P5) | ⬜ |
| T14 | Agent run: open claims → `check()` → planner (rules first; then Claude **via MeshAPI**, tool-only strict JSON: it can hold or escalate, never add payees or change amounts) → proposal with reasons → approver co-signs ESCALATED claims in `/org` (wallet tx) → agent settles PAYABLE ones with `settle(claim, sig, decisionHash)`. Executors: Worker = server agent key, or a Circle developer-controlled wallet once P5 keys exist; local runner = Circle CLI agent wallet | C | one full run on testnet with reasons: `pnpm e2e:agent` live ([run](deployments/agent-e2e.json)): escalate → co-sign → Settled with the decision hash → payee paid; a "pay my new wallet, urgent" claim that passes the contract is held with reasons. `/org` has "Run the agent" + co-sign | ✅ |
| T14b | The model in the loop, live: Claude via MeshAPI reviews each run with read-only tools (`dry_run`, `payee_history`); code already in `lib/agent.ts` + `lib/llm.ts` | C | a live run shows the model's reasons (needs `MESH_API_KEY`, P5) | ⬜ |
| T14c | Circle executors: the hosted agent settles through a Circle developer-controlled wallet (REST contract execution); a local runner settles through the Circle CLI agent wallet and the server records the tx | C | a hosted settle sent by a Circle wallet (needs P5 Circle keys) | ⬜ |
| T15 | Decision log in D1: hash-chained records (inputs, check() results, planner output, executor), `decisionHash` passed to `settle()`, head anchored with `Mandate.anchor`; `replay <id>` re-checks signatures + `check()` at the recorded block (never re-asks the model) | C | replay works: `GET /api/agent/replay` live — chain, payee signature, `check()` at the recorded block, payment event and anchor all verified in `e2e:agent` | ✅ |
| T16 | Indexer (Workers cron: events → D1, ≤ 9,999-block windows, cursor) + receipts + `/status` + dashboard with three tiers (external / first-party / sandbox excluded) | C | dashboard shows real tx | ⬜ |
| T17 | Sandbox org (tier SANDBOX) + `/try` judge path with no wallet: look-alike refusal via `check()`, recorded refusal tx, public verify lookup | C | `/try` works logged out | ⬜ |
| T18 | Hosting: always-on host, database, domain + TLS, secrets in the host store, `/status` page | C+P | live URL ✅ Cloudflare Workers + D1 (Pankaj's choice; Hono split only if Workers limits bite). All 4 e2e suites pass against the live URL (31/31). Left: domain (P1), `/status` (with T16) | ✅ |
| T19 | Books: beancount writer (6 decimals, explicit tolerance, balance assertion from chain) + `bean-check --json` | C | sample ledger passes | ⬜ |
| T20 | MCP server on the sandbox org only: `dry_run` by default, idempotency signal on every tool, rate limits | C | a judge's Claude can call it | ⬜ |
| T21 | Agent judgment inbox: duplicate invoice under a new number, claim missing evidence, look-alike "new wallet" email with a hidden instruction → reasons shown, `settle()` refuses | C | demo scene recorded | ⬜ |

### Traction (every day, 2 hours)
| ID | Task | Owner | Done when | Status |
|---|---|---|---|---|
| P1 | Buy the domain (sendsure.com or sendsure.xyz) and tell Claude | P | domain bought | ⬜ |
| P2 | Confirm the Luma registration; use GitHub `0x-pankaj` (with the hyphen) everywhere | P | confirmed | ⬜ |
| P3 | Organizer questions in a public Canteen channel: does a testnet rehearsal / payout check count as a business onboarded; the event_name; a test-USDC grant; ask for 2–3 intros | P | posted | ⬜ |
| P4 | Outreach: 30–40 named teams that pay contractors in stablecoins, ranked by next real payout date; 10 personal messages a day, follow-ups at 24 h and 72 h, never bulk | P | Sep 29: 30+ sent, 6+ calls; Oct 1: 3+ orgs active | ⬜ |
| P5 | Keys: **MeshAPI key** (`MESH_API_KEY=rsk_…`, for all AI) and a Circle Console TEST API key + entity secret (sandbox treasury), written into `apps/web/.env.local` yourself (never in chat) | P | in `.env.local` | ⬜ |
| P6 | Sep 30 beancount fireside: confirm time/link; bring the six-decimal tolerance question | P | attended | ⬜ |
| P7 | Hosting account: Cloudflare, Pankaj's own (he chose Workers on Sep 29: "if not work then split backend with hono") | P | confirmed | ✅ |

### Submission
| ID | Task | Owner | Done when | Status |
|---|---|---|---|---|
| S1 | First Loom (60–90 s) + first form submission with repo + diff link | C+P | submitted (target Sat Oct 3) | ⬜ |
| S2 | README in house style: "X does Y, here is the file"; Circle surfaces table with a proof column; prior art and what's different; threat model; "who can move money" matrix | C | reviewed | ⬜ |
| S3 | Evidence folder: traction.json (every counted org, run, settle with tx), redacted decision log, anchor txs; nightly DB backup off-host | C | committed at the freeze | ⬜ |
| S4 | Final video: 4–5 scenes, at most 2:45, captions, sandbox scenes labelled | C+P | uploaded | ⬜ |
| S5 | Final submission + final `arc-canteen update product` and `update traction`; re-login the Circle CLI on Oct 10 | P | submitted by Oct 10 evening | ⬜ |

## Deferred: only if ahead after Mon Oct 5
Onramp "Add funds" · Earn/USYC · cross-chain payouts via CCTP · paid x402 payee lookup for other agents ·
hosted Odoo (show a video + docker compose instead) · ERPNext issue · more CSV formats · passkey payee UI
(the contract already supports `bind()` from a smart account).

## Kill switch
- **Tue Sep 29 (today):** by tonight, 30+ messages sent, 6+ calls booked, 1+ org activated. If not,
  switch to intro-first outreach and cut scope further.
- **Thu Oct 1:** 3+ orgs active, or cut everything in *Deferred* and spend the extra time onboarding.
- **Any new idea after Wed Oct 7:** refuse it. The last days are for packaging.

## Locked decisions
- **Name:** SendSure.
- **AI:** all model calls go through **MeshAPI** (`https://api.meshapi.ai/v1`, OpenAI-compatible; Claude models as `anthropic/…`). Said by Pankaj, Sep 29.
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
