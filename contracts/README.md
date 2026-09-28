# SendSure contracts

The AI agent can only *ask* to pay. These contracts decide whether money moves.

| File | What it does |
|---|---|
| [`src/PayeeRegistry.sol`](src/PayeeRegistry.sol) | Payees prove their own payout address by signing with it (or by sending the transaction from it). Changing it needs the old key **and** the new key, and waits out a cooldown. No names or amounts are stored on-chain. |
| [`src/Mandate.sol`](src/Mandate.sol) | One per business. `settle()` is the only code that moves money, and `check()` runs the same rules as a dry run. |
| [`src/MandateFactory.sol`](src/MandateFactory.sol) | Creates one Mandate per business (an EIP-1167 clone) and registers it with the PayeeRegistry. |

## What `settle()` checks before paying

The money stays in the business's own wallet (`treasury`), which gives the Mandate a capped allowance.
`settle()` pays only if **all** of these hold:

1. The payee's address is bound, active, not frozen and not changing.
2. The claim is signed by that payout key, or submitted on-chain from it.
3. The invoice reference was never paid, and the claim is not expired or replayed.
4. The amount fits the per-claim max and the per-payee and per-business caps for the period. Caps
   start at zero, so a business that sets no budget can pay nothing.
5. The allowance and balance cover the amount, and neither side is on the token's blocklist.
6. An approver has co-signed on-chain if any of these apply:
   - the payee's running total for the period goes above the threshold;
   - it is the first payment to a new or changed address;
   - the address was vouched for by the payer rather than proven.

When a rule fails, nothing moves. `settle()` emits `Refused`, `Escalated` or `AlreadySettled` instead
of reverting, so every decision leaves a trace. Its ABI is flat
(`settle(bytes claim, bytes payeeSig, bytes32 decisionHash)`) because the Circle CLI passes every
argument as a string.

## What the tests prove

| File | Tests |
|---|---|
| [`test/Mandate.t.sol`](test/Mandate.t.sol) | 30 tests (see below). |
| [`test/PayeeRegistry.t.sol`](test/PayeeRegistry.t.sol) | 14 tests: binding needs an open slot, signatures can't be replayed or moved to another business, blocklisted addresses can't bind, changes need both keys, revoke and re-bind. |
| [`test/MandateInvariant.t.sol`](test/MandateInvariant.t.sol) | 3 invariants over random claims, co-signs, allowance changes and time jumps (8,192 calls each). |

`test/Mandate.t.sol` covers:
- **The six attacks that broke the pre-window sketch** (see `prior-work/horos-spike/AUDIT.md`), all
  now refused.
- Forged signatures, claims replayed on another business, a revoked allowance, a blocklisted payee.
- A "we changed our wallet" scam, frozen payees, caps and pause.
- A fuzz test showing `check()` always gives the same answer as `settle()`.

The three invariants are:
- money leaves the treasury only to bound payees, and the totals match;
- a paid obligation stays paid;
- the business cap holds in every period.

```bash
cd contracts && forge test
```

**Status:** not deployed yet. These contracts get a review before their first Arc testnet deploy.
