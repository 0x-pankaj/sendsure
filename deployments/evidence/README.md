# Evidence (exported 2026-10-11 14:41 UTC)

Every number on [/dashboard](https://sendsure.0xpankaj.workers.dev/dashboard), listed with its Arc testnet transaction in
[traction.json](traction.json). Counted from SendSure's contracts' events, in three tiers:
**external** (owner is not one of our wallets: the only tier that counts as traction), **first-party**
(our own wallets, listed in the file) and **sandbox** (our tests: counted, never listed or claimed).
Each payment's receipt shows the payee's proof, the signed claim, the agent's decision and the
decision-log head anchored on Arc. The database is Cloudflare D1, whose Time Travel keeps 30 days of
point-in-time restores. Re-export with `pnpm evidence`.

| Tier | Orgs | Payees who proved their address | Payments | Co-signs | Anchored log heads |
|---|---|---|---|---|---|
| external | 0 | 0 | 0 | 0 | 0 |
| first-party | 9 | 8 | 8 | 8 | 17 |
| sandbox | counted only: 96 orgs, 69 payments | | | | |

## Payments by outside teams

- none yet

## Payments from our own wallets (first-party, not traction)

- 0.2 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0xe8d4c39d52810278ead855afad92fa05facb00c47286c3fc0a376922676754ce), [tx](https://explorer.testnet.arc.io/tx/0xe8d4c39d52810278ead855afad92fa05facb00c47286c3fc0a376922676754ce)
- 0.2 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0x3be27d6c4b7b7f022480bd0ee52bf11f9404aa6efca28f918f1714261292fa6f), [tx](https://explorer.testnet.arc.io/tx/0x3be27d6c4b7b7f022480bd0ee52bf11f9404aa6efca28f918f1714261292fa6f)
- 0.2 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0xe6f8d29b7910a52cd0a34b46efae42868610e980c11f9a5db252bff0c79deeef), [tx](https://explorer.testnet.arc.io/tx/0xe6f8d29b7910a52cd0a34b46efae42868610e980c11f9a5db252bff0c79deeef)
- 0.2 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0x37ccc2be96c68d7ad0c1ae9697a80172ce3a0704aa2186992caccb9ea516979e), [tx](https://explorer.testnet.arc.io/tx/0x37ccc2be96c68d7ad0c1ae9697a80172ce3a0704aa2186992caccb9ea516979e)
- 0.2 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0x618959e44c6005731c99e83a8cb3fc2aec678736059e11a703363801566dc46a), [tx](https://explorer.testnet.arc.io/tx/0x618959e44c6005731c99e83a8cb3fc2aec678736059e11a703363801566dc46a)
- 0.25 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0xbe1e750b8e257b18a016197cfde7a23789d95f4560eae83362621383f4945746), [tx](https://explorer.testnet.arc.io/tx/0xbe1e750b8e257b18a016197cfde7a23789d95f4560eae83362621383f4945746)
- 1.5 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0x9392463aba3157398c8a0ef253a45c81da10197334048f67870257f466dc77bf), [tx](https://explorer.testnet.arc.io/tx/0x9392463aba3157398c8a0ef253a45c81da10197334048f67870257f466dc77bf)
- 0.8 USDC: [receipt](https://sendsure.0xpankaj.workers.dev/receipt?tx=0x9b5de3ac5b78ee9b43e3c37ffb1f1f368cf7d5cd5606c4b11b23813270b36e36), [tx](https://explorer.testnet.arc.io/tx/0x9b5de3ac5b78ee9b43e3c37ffb1f1f368cf7d5cd5606c4b11b23813270b36e36)
