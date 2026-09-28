# Baseline: what existed when Tameion opened

The Tameion window opened on **Sun Sep 27, 2026, 00:00 ET** (04:00 UTC).

**Arc testnet block at window start:**
- Block **64,209,436**, the first block with a timestamp of 2026-09-27T04:00:00Z or later.
- Chain 5042002.
- Block hash `0x308d458c1d324be9e9bd0f59d41fdbe1408edcb821f75ad69bf3cfff140aac46`.

## State at window start

- SendSure contracts deployed: **none**.
- Businesses (payers) onboarded: **0**. Payees: **0**. Claims: **0**. Payment volume: **0**.
- Product code: **none**. Only the research files below existed.

## Files that existed before the window

They were copied unchanged into `prior-work/`. Times are file modification times in ET.

| File | Last modified (ET) | sha256 |
|---|---|---|
| `prior-work/horos-spike/foundry.toml` | 2026-09-14 13:49 | `a7adf1e3168b73a9105a0b70731ad92d3acac76b9b1654309334c2dbbc126317` |
| `prior-work/horos-spike/src/Horos.sol` | 2026-09-14 13:51 | `590f31cd15350fc0021894ccb46a9b99a9dc715bfb2d28c1a8674e6e85a41ca8` |
| `prior-work/horos-spike/test/Horos.t.sol` | 2026-09-14 13:51 | `29b7f9331f36a3ec7b5033754c2844542ff218c0f2fdd245680a68516b7bab87` |
| `prior-work/odoo-usdc-repro/README.md` | 2026-09-25 16:28 | `0f1300bda92c24df9f38c22fae4b2a616b4feced3921567857d850ea81f7b3c8` |
| `prior-work/odoo-usdc-repro/addons/usdc_arc_gate/__init__.py` | 2026-09-25 16:24 | `5fd10918e1361ad65b4b41bcd8fb525e659267f47c8c4334ae52530e58908e9e` |
| `prior-work/odoo-usdc-repro/addons/usdc_arc_gate/__manifest__.py` | 2026-09-25 16:24 | `4c451f10419ef5584448aab7815b908bfa682ba608ad6a174d676e07a3a7d122` |
| `prior-work/odoo-usdc-repro/addons/usdc_arc_gate/data/payment_method.xml` | 2026-09-25 16:24 | `06d8875c7778fd8fe67df04d0a694ef9ef9badd2c39e769fad06bacd77d047a7` |
| `prior-work/odoo-usdc-repro/addons/usdc_arc_gate/models/__init__.py` | 2026-09-25 16:24 | `eef74a1eda29b78d14a90b73ca6c2cc46ce54428e988e61b751edfacba5ef110` |
| `prior-work/odoo-usdc-repro/addons/usdc_arc_gate/models/payment.py` | 2026-09-25 16:24 | `a5a1ffe8dd5d3dc6ae171364629bc6487425ba963df148eb245a8ad061f9cccf` |
| `prior-work/odoo-usdc-repro/docker-compose.yml` | 2026-09-25 16:24 | `f24d5ebd3d35accb9e6cae853b92cdad9c70404e00283a314a999d8c312abd68` |
| `prior-work/odoo-usdc-repro/repro.py` | 2026-09-25 16:44 | `88f1a7aa51d016fca93be67f961baed4e19cb5dc9757a158e130f17acfde4e4f` |
| `prior-work/odoo-usdc-repro/results.txt` | 2026-09-25 16:27 | `2219018897a655c2412c88645e116f5804b23e7c5848acd3126c9005409c85f6` |
| `prior-work/odoo-usdc-repro/run.sh` | 2026-09-25 16:44 | `b07ef3f405a89547b8815977d1c0edfcbbd6a669c46c2638ae238ece7959ca12` |

## What these files are

### `prior-work/horos-spike/`
- An early Solidity sketch of a payment-release rule, from Sep 14. It was never deployed.
- It is **not** SendSure's contract.
- An audit during the window found six ways to break it. Those tests are added after this baseline.
- SendSure's contracts are written new during the window.

### `prior-work/odoo-usdc-repro/`
A reproduction of three Odoo 19 Community behaviours when vendor bills are paid in six-decimal USDC. It is research, not product.
1. "USDC" as a currency code is cut to "USD".
2. The trusted-account check exists, but no Community payment method uses it.
3. A $250.00 bill paid with 249.995 USDC is marked paid.

## Earlier Canteen events

Pankaj entered Agora (arcMurmur) and Lepton (SplitStream). **No code from those projects is used in SendSure.**

## How to check

- Only the hackathon work: https://github.com/0x-pankaj/sendsure/compare/tameion-baseline...main
- `git show tameion-baseline --stat` lists exactly what existed before the window.
