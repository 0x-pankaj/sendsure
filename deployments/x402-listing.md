# SendSure paid checks: Circle agent marketplace submission

Submit through https://agents.circle.com/services → "Talk to us". This is a request to be listed;
there is no self-serve publish command.

- **Provider:** SendSure (https://sendsure.0xpankaj.workers.dev), source https://github.com/0x-pankaj/sendsure (MIT)
- **Category:** Payments / security (payee verification, address-poisoning checks)
- **Payment:** x402 v2 over Circle Gateway Nanopayments (`GatewayWalletBatched`), USDC. Testnet today: Arc testnet
  (`eip155:5042002`) and 11 other Gateway testnets. Seller `0x1B66e68D3F61D84B5498013b0981537DBef28b73`.
- **Catalog:** `GET https://sendsure.0xpankaj.workers.dev/api/x402`
- **Health:** `GET https://sendsure.0xpankaj.workers.dev/api/status`, status page https://sendsure.0xpankaj.workers.dev/status
- **Support:** https://github.com/0x-pankaj/sendsure/issues

## Services

### Verify a payee: `POST /api/x402/verify-payee`, $0.001

Before an agent pays anyone: is this the payout address the payee proved (signed with) for this SendSure org, right now?

Request:
```json
{ "org": "0x8FA4f5ee6f04D3Bf1A1a5113799508C171DD076C", "address": "0x7fBe6E582F8D7c0ee4C4855573731BE9dbC98522" }
```
Response:
```json
{ "verified": true, "state": "BOUND", "proof": "PROVEN", "since": { "tx": "0xa71e…1a99", "block": 64554960 }, "orgTier": "sandbox" }
```
`state` is one of `BOUND`, `FROZEN`, `CHANGE_PENDING`, `NOT_A_PROVEN_PAYEE`, `NOT_A_SENDSURE_ORG`.

### Check a payout file: `POST /api/x402/check-payout`, $0.005

Compares a stablecoin payout CSV with the last one paid: changed wallets, look-alike (poisoned) addresses, duplicates,
amount jumps. Each row gets PAY / REVIEW / STOP with a plain explanation.

Request: `{ "payout_csv": "payee,address,amount\n…", "last_paid_csv": "optional, same format" }`
Response: `{ "summary": { "rows", "byAction", "byStatus", "amountByAction" }, "rows": [{ "payee", "address", "amount", "action", "status", "flags", "explanation" }], "warnings": [] }`

Bad input answers 400 before any charge.

## Example agent prompts

- "Before you send the contractor payout, verify each address with SendSure."
- "Check this month's payout CSV against last month's and stop anything that looks poisoned."
- "Is 0x7fBe…8522 the address this payee proved for our org?"

## Evidence

[`x402-e2e.json`](x402-e2e.json), from `pnpm e2e:x402`: unpaid request → 402 with `PAYMENT-REQUIRED`;
`circle services inspect` → payable; `--estimate`; paid calls → 200, settled by Gateway.
