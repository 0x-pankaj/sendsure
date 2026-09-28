# SendSure

SendSure is a payables agent for teams that pay contractors in stablecoins. It pays only a payee
who has proven their own payout address, only for a claim that payee signed, and only inside a
budget an Arc contract enforces. Then it writes each payment into the books the team already keeps.

**Live on Arc testnet:** https://sendsure.0xpankaj.workers.dev

Built during the **Tameion Agents Hackathon** (Canteen × Circle × Arc), Sep 27 – Oct 10, 2026, on
Arc testnet (chain 5042002). Testnet only; not audited.

## Try it

| How | What you see |
|---|---|
| [`/try`](https://sendsure.0xpankaj.workers.dev/try), no wallet | In two minutes: a payee proves their address, a look-alike address is caught, an attacker's claim is refused on-chain, a "pay my new wallet" change is refused, a real payment is escalated, co-signed and paid, with a receipt and books. |
| [`/check?example`](https://sendsure.0xpankaj.workers.dev/check?example) | The free payout check: compares your payout CSV with the last one you paid (changed, new, look-alike, duplicate, amount jumps). It runs in your browser; nothing is uploaded. |
| [`/org`](https://sendsure.0xpankaj.workers.dev/org) | Set up a team: create the org, set a budget, invite payees, run the agent, co-sign, download books. You only sign; SendSure pays the gas. |
| MCP, for your agent | `claude mcp add --transport http sendsure https://sendsure.0xpankaj.workers.dev/api/mcp` |
| [`/dashboard`](https://sendsure.0xpankaj.workers.dev/dashboard) | Every number counted from chain events, in three tiers. Sandbox activity is never counted as traction. |

## How it works

1. **The payee proves their address, once.** The payer sends an invite link. The payee signs an
   EIP-712 `Bind` with the wallet they want to be paid to; SendSure's relayer submits it.
2. **The payee signs a claim for each invoice.** The server salts the invoice number
   (`refHash`), runs the contract's own `check()` and stores the signed claim.
3. **The agent runs.** Rules first (the `check()` result plus red flags from the payee's history),
   then Claude via MeshAPI reviews with read-only tools. The model can only make a decision more
   careful. Every decision is hash-chained; its hash goes into the payment; the log head is
   anchored on-chain.
4. **A person co-signs** first payments to a new address, payer-vouched addresses and amounts
   above the threshold, on-chain, for that exact claim.
5. **The Circle agent wallet pays** with `settle()`. The contract re-checks everything and moves
   USDC from the payer's own wallet through a capped allowance.
6. **Receipts and books.** A public receipt per payment, and beancount books reconciled to the
   treasury's on-chain balance.

## What does what

| Part | What it does | File |
|---|---|---|
| PayeeRegistry | Payees prove their own address; a change needs the old key **and** the new key, then a cooldown. | [`contracts/src/PayeeRegistry.sol`](contracts/src/PayeeRegistry.sol) |
| Mandate | One per business. `settle()` is the only code that moves money; `check()` is the same rules as a dry run. | [`contracts/src/Mandate.sol`](contracts/src/Mandate.sol) |
| MandateFactory | Creates each business's Mandate (EIP-1167 clone). Only factory-made orgs count anywhere. | [`contracts/src/MandateFactory.sol`](contracts/src/MandateFactory.sol) |
| Payout check | Changed / new / look-alike / duplicate / amount-jump detection, in the browser. | [`packages/core/src/payoutCheck.ts`](packages/core/src/payoutCheck.ts) |
| Relayer | Checks each signature offline, simulates, then submits; per-address limits count only verified requests. | [`apps/web/lib/relayer.ts`](apps/web/lib/relayer.ts), [`orgRelay.ts`](apps/web/lib/orgRelay.ts) |
| Claims | Salted invoice refs, the contract's dry run before storing, one open claim per invoice. | [`apps/web/lib/claims.ts`](apps/web/lib/claims.ts) |
| Agent | Rules, red flags, the MeshAPI tool loop, settle and anchor. | [`apps/web/lib/agent.ts`](apps/web/lib/agent.ts), [`llm.ts`](apps/web/lib/llm.ts) |
| Decision log | Hash chain, anchors, and replay without the model. | [`decisionLog.ts`](apps/web/lib/decisionLog.ts), [`replay.ts`](apps/web/lib/replay.ts) |
| Circle agent wallet runner | Signs in as the Circle agent wallet (ERC-1271), sends `settle()` and `anchor()` with `circle wallet execute`. | [`scripts/agent-circle.ts`](scripts/agent-circle.ts) |
| Books | Beancount with each payment's claim, decision hash and Arc tx; daily balances from the chain. | [`packages/core/src/beancount.ts`](packages/core/src/beancount.ts), [`apps/web/lib/books.ts`](apps/web/lib/books.ts) |
| Indexer and dashboard | Chain events into D1 (≤ 9,999-block windows); three tiers; public receipts. | [`indexer.ts`](apps/web/lib/indexer.ts), [`stats.ts`](apps/web/lib/stats.ts), [`receipt.ts`](apps/web/lib/receipt.ts) |
| MCP server | Payout check, address lookup, receipts, stats, and a sandbox-only, dry-run-by-default demo tool. | [`apps/web/lib/mcp.ts`](apps/web/lib/mcp.ts) |
| Schema | Cloudflare D1 (the same SQL runs on local SQLite for tests). No payee names are stored. | [`apps/web/migrations/`](apps/web/migrations/) |

## Circle and Arc, with proof

| Surface | How SendSure uses it | Proof |
|---|---|---|
| Circle CLI agent wallet (Agent Stack) | The Circle agent wallet is an agent of every org: it sends `settle()` and `anchor()` itself, and signs in to SendSure with an ERC-1271 signature. | [circle run](deployments/circle-e2e.json) (settle, anchor, replay), [smoke test](deployments/smoke-test.md) |
| USDC on Arc | Payouts are USDC; gas is USDC; budgets are EIP-2612 `permit`s, so payers never need gas to onboard. | [org run](deployments/org-e2e.json) (budget by permit), permit domain checked against the token in [`org.test.ts`](packages/chain/test/org.test.ts) |
| USDC blocklist | Blocklisted addresses cannot bind or be paid; a blocklisted treasury cannot pay. | `isBlacklisted` in the contracts; `test_BlocklistedAddressCannotBind` |
| Arc testnet | Contracts deployed and source-verified; archive state lets replay re-run `check()` at the recorded block. | [`deployments/arc-testnet.json`](deployments/arc-testnet.json) |
| Circle Wallets (developer-controlled) | Next: the hosted agent settles through a Circle wallet so no laptop is needed. | not yet |

## Who can move money

| Who | Can | Cannot |
|---|---|---|
| Treasury (the payer's own wallet) | Holds the money; sets or revokes the Mandate's allowance. | Be paid by its own Mandate. |
| Owner | Set caps, agents and approvers; open invites; freeze or revoke payees; pause. | Change a payee's address, or sign a payee's claim. |
| Approver | Co-sign one exact claim; pause; freeze; cancel a pending address change. | Send money. |
| Agent (Circle agent wallet, SendSure server agent) | Call `settle()`, which pays only if every rule passes; anchor the log; open invites. | Change caps, payees or addresses; pay an unproven address or an unsigned claim; skip a required co-sign. |
| Payee | Prove their address; sign claims; change address with both keys and a waiting period. | Get paid outside the caps, the allowance or a required co-sign. |
| Relayer key | Pay gas for signatures that it checked. | Anything else: it has no role in any contract. |
| The model (Claude via MeshAPI) | Hold or escalate a claim, with reasons. | Pay, add payees, change amounts, or overrule a person's co-sign. |

The worst case for a stolen agent key is bounded by the allowance the treasury granted, paid only
to addresses payees proved, for claims they signed, with first payments waiting for a person.

## Threat model

| Attack | What stops it | Where to see it |
|---|---|---|
| Address poisoning (a look-alike in the payout list) | The payout check flags it; the contract only pays the address the payee proved. | `/try` step 2; [`payoutCheck.test.ts`](packages/core/test/payoutCheck.test.ts) |
| "Please pay my new wallet" (business email compromise) | A change needs the old key and the new key, then a cooldown the payer can cancel; the agent holds claims that ask for it. | [change run](deployments/relay-e2e-change.json), [agent run](deployments/agent-e2e.json) #3 |
| Forged invoice | A claim must be signed by the payee's proven key (EIP-712, bound to the org and the chain); the contract refuses others on-chain. | [claim run](deployments/claim-e2e.json), `/try` step 2 (Refused `BAD_SIGNATURE`) |
| Duplicate invoice | The salted invoice ref makes one obligation, paid once; one open claim per invoice; the agent flags repeated amounts and overlapping periods. | `DUPLICATE_REF` tests; [`agent.test.ts`](apps/web/test/agent.test.ts) |
| Prompt injection in claim text | Claim text is data; the model can only be more careful; rules flag "ignore previous rules", "urgent", "new wallet". | [`agent.test.ts`](apps/web/test/agent.test.ts) |
| Leaked invite link | The first payment to a new address needs a person; the real payee sees "already confirmed" and tells the payer, who can freeze it. | [`Mandate.t.sol`](contracts/test/Mandate.t.sol) |
| Edited decision log | The chain breaks against the on-chain anchors; replay re-checks from the chain. | [agent run](deployments/agent-e2e.json) (replay), `verifyChain` test |
| Look-alike contract emitting `Settled` | Receipts and the dashboard only count orgs the SendSure factory created. | [`receipt.ts`](apps/web/lib/receipt.ts) |
| Replayed signatures | Per-signer nonces, expiries, EIP-712 domains with chain id and contract. | registry and relayer tests |

Known limits: testnet only; not audited; an invite link works for whoever uses it first (the
first-payment co-sign is the backstop); rate limits live in each Worker isolate.

## Prior art, and what's different

- Banks have Confirmation of Payee (UK) and Verification of Payee (EU), which check the name on an
  account before a transfer. SendSure applies the idea to stablecoin payouts, and the payee proves
  the address with their own key.
- Multisigs and allowlists control who approves and where money may go, but the address itself
  still comes from the payer's list.
- What SendSure adds is the combination, enforced by a contract: a payee-proven address, a
  payee-signed claim, a capped budget with a person's co-sign where it matters, an agent whose
  every decision is hash-chained and anchored, and books reconciled to the chain.

## Tests and live runs

- Contracts: 47 tests (`forge test` in [`contracts/`](contracts/)): 30 Mandate, 14 registry, 3 invariants.
- TypeScript: 58 tests (`pnpm test`): payout check and books (17), chain helpers with live
  cross-checks against the deployed contracts (16), web server (25).
- Live runs against the deployed site, with throwaway keys on sandbox orgs (not traction):
  [bind](deployments/relay-e2e.json) 4/4, [change](deployments/relay-e2e-change.json) 7/7,
  [org](deployments/org-e2e.json) 9/9, [claim](deployments/claim-e2e.json) 11/11,
  [agent](deployments/agent-e2e.json) 10/10, [circle](deployments/circle-e2e.json) 10/10,
  [try](deployments/try-e2e.json) 9/9; [books](deployments/books-e2e.beancount) pass `bean-check`.

## Run it

```bash
pnpm install && pnpm gen && pnpm typecheck && pnpm test
pnpm --filter @sendsure/web dev                    # local; needs apps/web/.env.local (see PLAN.md)
pnpm --filter @sendsure/web cf:deploy              # Cloudflare Workers + D1
pnpm e2e:agent --base https://sendsure.0xpankaj.workers.dev
```

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
