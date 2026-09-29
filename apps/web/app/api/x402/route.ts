export const dynamic = "force-dynamic";

/** Free catalog of SendSure's paid agent endpoints (x402 over Circle Gateway Nanopayments). */
export function GET(req: Request) {
  const base = new URL(req.url).origin;
  return Response.json({
    provider: "SendSure",
    payment: "x402 v2 over Circle Gateway Nanopayments (gasless, batched USDC); any Gateway-supported testnet, incl. Arc testnet",
    services: [
      {
        url: `${base}/api/x402/verify-payee`,
        method: "POST",
        price: "$0.001",
        description:
          "Before paying anyone: is this the payout address the payee proved (signed with) for this SendSure org, right now?",
        request: { org: "0x… (the payer's SendSure org)", address: "0x… (the address you are about to pay)" },
        response: {
          verified: "boolean",
          state: "BOUND | FROZEN | CHANGE_PENDING | NOT_A_PROVEN_PAYEE | NOT_A_SENDSURE_ORG",
          since: "{ tx, block }",
        },
      },
      {
        url: `${base}/api/x402/check-payout`,
        method: "POST",
        price: "$0.005",
        description:
          "Check a stablecoin payout list against the last one: changed wallets, look-alike addresses, duplicates, amount jumps.",
        request: { payout_csv: "CSV with payee, address, amount", last_paid_csv: "optional, same format" },
        response: { summary: "counts", rows: "[{ action: PAY | REVIEW | STOP, status, explanation }]" },
      },
    ],
  });
}
