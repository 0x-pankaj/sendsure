# SendSure roadmap

Dated and honest. "Done" items link to proof in the [README](README.md). Everything is on Arc testnet
today; nothing here has been audited.

## Done during the hackathon (Sep 27 – Oct 10, 2026)

- Contracts on Arc testnet: payee-proven addresses, payee-signed claims, a budget the contract
  enforces, co-signs for first and large payments, anchored decisions.
- The agent: contract rules first, then Claude with read-only tools; it can only be more careful.
  It plans cash (oldest work first when money is short) and can run on its own schedule (autopilot),
  waking only when something changed.
- Books: an Odoo 19 add-on and an ERPNext 15 app, each with tests that run inside it, plus beancount,
  hledger, journal CSV and statement CSV, each checked by the tool it is for.
- For other agents: an MCP server and paid checks over Circle Gateway (x402).
- A free payout check that needs no wallet and uploads nothing. It compares EVM, Solana, Tron, Stellar,
  Cosmos, bitcoin (bc1) and Polkadot addresses exactly.
- Ready for real teams: a payee path that works from a phone, a built-in testnet faucet, Discord or
  Slack notices when a claim waits for a co-sign, and replay protection that holds on every server.
- Every flow re-run against the live site: 14 suites, one of them in a real browser with a
  MetaMask-style wallet.

## Next: the traction week (Oct 11 – 17)

| What | Why |
|---|---|
| First outside teams through `/org` | The product is only proven when someone else's payout runs through it. |
| The hosted agent pays through a Circle developer-controlled wallet | Today the live site settles with a server key; the Circle agent wallet pays from the command line. |
| A domain of our own | Trust, and a stable origin for passkeys later. |

## After the hackathon

| What | Notes |
|---|---|
| Mainnet with design partners | After an audit of the contracts. The contracts are small on purpose: about 1,100 lines in three files. |
| Payee lookup as a public good | "Has this address been proven by its owner for this payer?" as an API and an x402 endpoint for wallets and payout tools. The testnet version is live. |
| More books | An Odoo app-store listing; the same exact-recording rule for other ledgers teams ask for. |
| Passkey payees | The registry already accepts a bind from a smart account; the payee page needs the passkey flow. |
| Payout addresses beyond EVM | The registry holds EVM addresses today. |
| Email notice when a co-sign is waiting | Discord and Slack notices are live; email is not. |

## How it can pay for itself

Not decided; to be set with the first design partners. What exists today: the payout check is free,
and agents already pay per call for the two x402 checks ($0.001 and $0.005 in testnet USDC). The
natural paid unit is a team's monthly payout run.

## What we need

Introductions to teams that pay contractors, vendors or grantees in USDC, and an audit partner before
mainnet.
