// End-to-end check: other agents pay SendSure per call with USDC nanopayments (x402 over Circle Gateway), Arc testnet.
// The buyer is our own Circle agent wallet (Circle CLI), so these calls count as first-party, never traction.
//   1. unpaid POST -> HTTP 402 with a PAYMENT-REQUIRED header that accepts Arc testnet through Gateway
//   2. `circle services inspect` sees a payable service; `--estimate` quotes the price without paying
//   3. paid verify-payee ($0.001): a payee proven on-chain comes back BOUND; the settlement is recorded
//   4. paid check-payout ($0.005): a changed wallet and a look-alike (poisoned) address are both stopped
//   Needs the Circle CLI signed in, with a Gateway balance on ARC-TESTNET (circle gateway deposit ... --method direct).
//   pnpm tsx scripts/e2e-x402.ts [--base https://sendsure.0xpankaj.workers.dev]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CIRCLE_AGENT } from "./agent-circle";
import { arg } from "./lib/env";
import { check, failed } from "./lib/relay";

const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(base)) throw new Error(`--base must be a plain https origin, got ${base}`);
const CHAIN = "ARC-TESTNET";
const ARC = "eip155:5042002";

/** The Circle CLI, without a shell: every argument is passed as-is. */
function circle(...args: string[]): any {
  const out = execFileSync("circle", [...args, "--output", "json"], { encoding: "utf8", timeout: 150_000 });
  return JSON.parse(out).data;
}

const stats = async () => (await (await fetch(`${base}/api/stats`)).json()) as any;

// A payee that really proved its address: the payout of the latest settled payment.
const before = await stats();
const paid = before.recentPayments?.[0] as { org: string; payout: string } | undefined;
if (!paid) throw new Error("no settled payment to take a proven payee from");
const callsBefore: number = before.paidCalls?.firstParty.calls ?? 0;

// 1. Unpaid
const verifyUrl = `${base}/api/x402/verify-payee`;
const body = JSON.stringify({ org: paid.org, address: paid.payout });
const unpaid = await fetch(verifyUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
const header = unpaid.headers.get("payment-required");
const reqs = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : null;
const arc = reqs?.accepts?.find((a: any) => a.network === ARC);
check(unpaid.status === 402 && reqs?.x402Version === 2, `unpaid call answered 402 with PAYMENT-REQUIRED (x402 v${reqs?.x402Version})`);
check(
  arc?.amount === "1000" && arc?.extra?.name === "GatewayWalletBatched",
  `accepts Arc testnet through Circle Gateway, 0.001 USDC (${reqs?.accepts?.length} networks in all)`,
);
const catalog = (await (await fetch(`${base}/api/x402`)).json()) as any;
check(catalog.services?.length === 2, `catalog lists ${catalog.services?.length} paid services`);

// 2. Inspect and estimate, no money moves
const inspected = circle("services", "inspect", verifyUrl, "-X", "POST");
check(inspected.status === "payable" && inspected.chains.includes(ARC), `circle services inspect: ${inspected.status}, ${inspected.price.formatted}`);
const estimate = circle("services", "pay", verifyUrl, "-X", "POST", "-d", body, "--address", CIRCLE_AGENT, "--chain", CHAIN, "--max-amount", "0.001", "--estimate");
check(estimate.chain === ARC && estimate.price === "$0.001 USDC", `estimate: ${estimate.price} on ${estimate.chain}, nothing paid`);

// 3. Paid verify-payee
const v = circle("services", "pay", verifyUrl, "-X", "POST", "-d", body, "--address", CIRCLE_AGENT, "--chain", CHAIN, "--max-amount", "0.001");
check(v.response?.verified === true && v.response?.state === "BOUND", `paid verify-payee: ${v.response?.state}, proof ${v.response?.proof}`);
const settlement = v.payment?.receipt ? JSON.parse(Buffer.from(v.payment.receipt, "base64").toString("utf8")) : null;
check(settlement?.success === true && settlement.network === ARC, `Gateway settled the payment (${settlement?.transaction})`);

// 4. Paid check-payout: one changed wallet, one look-alike of the address paid last time
const known = getAddress(paid.payout);
const changed = privateKeyToAccount(generatePrivateKey()).address;
const lookalike = getAddress(`${known.slice(0, 6)}${changed.slice(6, 38)}${known.slice(-4)}`.toLowerCase());
const csv = (rows: string[][]) => ["payee,address,amount", ...rows.map((r) => r.join(","))].join("\n");
const payout = JSON.stringify({
  payout_csv: csv([
    ["Alice", changed, "120"],
    ["Bob", lookalike, "80"],
  ]),
  last_paid_csv: csv([
    ["Alice", known, "120"],
    ["Bob", known, "80"],
  ]),
});
const p = circle("services", "pay", `${base}/api/x402/check-payout`, "-X", "POST", "-d", payout, "--address", CIRCLE_AGENT, "--chain", CHAIN, "--max-amount", "0.005");
const rows = (p.response?.rows ?? []) as { payee: string; action: string; status: string }[];
check(p.payment?.amount === "$0.005 USDC", `paid check-payout: ${p.payment?.amount}`);
check(rows.find((r) => r.payee === "Alice")?.status === "CHANGED", `changed wallet flagged: ${rows.find((r) => r.payee === "Alice")?.action}`);
check(
  rows.find((r) => r.payee === "Bob")?.status === "LOOKALIKE" && rows.find((r) => r.payee === "Bob")?.action === "STOP",
  `look-alike address stopped: ${rows.find((r) => r.payee === "Bob")?.status}`,
);

const after = await stats();
check(after.paidCalls?.firstParty.calls === callsBefore + 2, `dashboard counts ${after.paidCalls?.firstParty.calls} first-party paid calls (+2)`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/x402-e2e.json"),
  `${JSON.stringify(
    {
      note: "First-party end-to-end test: our own Circle agent wallet buys SendSure's paid checks with x402 over Circle Gateway on Arc testnet. Not traction.",
      ranAtUnix: Math.floor(Date.now() / 1000),
      base,
      buyer: CIRCLE_AGENT,
      buyerGatewaySigner: settlement?.payer,
      seller: arc?.payTo,
      unpaid: { status: unpaid.status, accepts: reqs?.accepts?.length, arc },
      inspect: inspected,
      estimate,
      verifyPayee: { request: JSON.parse(body), response: v.response, payment: { ...v.payment, receipt: settlement } },
      checkPayout: { summary: p.response?.summary, rows, payment: p.payment?.amount },
      dashboardFirstPartyPaidCalls: after.paidCalls?.firstParty,
    },
    null,
    2,
  )}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/x402-e2e.json");
process.exitCode = failed() ? 1 : 0;
