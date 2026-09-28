# Audit of the pre-window spike (Sep 27, 2026)

This audit was written during the Tameion window. [`test/Exploit.t.sol`](test/Exploit.t.sol) has six
tests, and each one **passes when the attack succeeds**. All six pass against `src/Horos.sol`, which is
why SendSure's contracts are written new rather than built on this sketch.

| Test | What goes wrong in the spike |
|---|---|
| `test_Attack_AgentSelfAssertsApproverSignature` | `settle()` trusts an "approver signed: true" flag that the agent passes in itself. |
| `test_Attack_SameObligationSettledTwiceWithFreshId` | The caller supplies the obligation ID, so a new ID pays the same bill again. |
| `test_Attack_SameInvoiceNumberDifferentAmountIsNewObligation` | The amount is part of the ID, so the same invoice at a new amount counts as a new bill. |
| `test_Attack_UnsetBudgetIsUnlimited` | A budget that was never set has no limit. |
| `test_Attack_OwnerRewritesPayeeAndZeroesCooldown` | The owner can change a payee's address and remove the waiting period. |
| `test_Fact_SettleHasNoTokenTransfer` | `settle()` never moves any USDC. |

SendSure's Mandate contract must refuse all six. It must also refuse forged signatures, replayed
bindings, revoked allowances and blocklisted payees.

To run it, add [forge-std](https://github.com/foundry-rs/forge-std) under `lib/`, then run
`forge test --match-contract HorosExploit -vv` in this folder.
