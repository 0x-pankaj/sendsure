# Live smoke test on Arc testnet

**First-party test, SANDBOX tier.** The payee is a synthetic test key. This is not traction.

- Org (Mandate clone): [`0x8C50103bE05877E41Fea5b3181c94E8123328e81`](https://explorer.testnet.arc.io/address/0x8C50103bE05877E41Fea5b3181c94E8123328e81)
- Circle agent wallet that called `settle()`: [`0x9f977c4efff254a9284e69a0ae2b03e4ab851c07`](https://explorer.testnet.arc.io/address/0x9f977c4efff254a9284e69a0ae2b03e4ab851c07)
- Payee: [`0x3460E7c7aA9439db630eAf9468653920e9900Dad`](https://explorer.testnet.arc.io/address/0x3460E7c7aA9439db630eAf9468653920e9900Dad); USDC 0.0 → 1.0

| # | Step | Result | Tx |
|---|---|---|---|
| 1 | createMandate (SANDBOX tier) | org 0x8C50103bE05877E41Fea5b3181c94E8123328e81 | [0x4e4b530d…](https://explorer.testnet.arc.io/tx/0x4e4b530dae4080c8a192dab933e88e51f5f7ca2e38b6452dda4ca175896052f1) |
| 2 | approve 5 USDC |  | [0xe525fb44…](https://explorer.testnet.arc.io/tx/0xe525fb44584a8413462517c439ebcf87b1615b3b7aad36106ae33cdf2f87df70) |
| 3 | openSlots |  | [0x8f4f574b…](https://explorer.testnet.arc.io/tx/0x8f4f574b056d3ae4740794030c5c162a73eba5eb8c8b40cbc4ecf20d39490b09) |
| 4 | bindWithSig (payee-signed, relayed) |  | [0x06523d95…](https://explorer.testnet.arc.io/tx/0x06523d95e49e47a738689ad86d4c0eaf65bad5ca3873bf8d795682c34e2d2c84) |
| 5 | agent wallet settle #1 | ['Escalated NEEDS_COSIGN_NEW_PAYOUT'] | [0xdacff441…](https://explorer.testnet.arc.io/tx/0xdacff4413f731b8a77d197873e38cd6e7f71aafd2c1afb2945339f8131327550) |
| 6 | approver cosign |  | [0xb06cdf8c…](https://explorer.testnet.arc.io/tx/0xb06cdf8cbe00105d65635270159e0f02d5652e7167964d1f3a1ed6a2030667e1) |
| 7 | agent wallet settle #2 | ['Settled'] | [0x0cd7c6f2…](https://explorer.testnet.arc.io/tx/0x0cd7c6f2d144619e95d638c1cc89f762529d8ccee53bd6498e9ae5a299f0b2b4) |
| 8 | retry settle | ['AlreadySettled'] | [0x76bba941…](https://explorer.testnet.arc.io/tx/0x76bba941dc7015cd6c9a36a45f7c359bb14fe4d536ded2de5c3f00e85c0a405c) |
| 9 | forged claim settle | ['Refused BAD_SIGNATURE'] | [0xccffa554…](https://explorer.testnet.arc.io/tx/0xccffa554edf6c20b012cab57445229b6553425db86f114a0a1f003f71a10cfe3) |

Reproduce: `python3 contracts/script/smoke_test.py` (needs the test keys in `contracts/.env`).
