// Server only. Traction numbers, counted only from indexed chain events, in three tiers:
//   external    production orgs whose owner is not one of ours: the only tier that counts as traction
//   first-party production orgs owned by our own keys (demos, dogfooding)
//   sandbox     tier-SANDBOX orgs (tests, judges' test wallets): never counted
import type { Address } from "viem";
import { SENDSURE_AGENTS, formatUsdc } from "@sendsure/chain";
import { getDb } from "./db";

/** Our own keys. Add more with FIRST_PARTY_ADDRESSES (comma-separated), e.g. Pankaj's own wallet. */
const BUILT_IN = [
  "0x38B01c787BFbA932d4601f0f761C950930700809", // deployer (test payer)
  "0x2c623fd23e9cEfE6EE655859a40a93ea9B7A80AC", // approver (test)
  "0x3460E7c7aA9439db630eAf9468653920e9900Dad", // smoke-test payee
  "0x1B66e68D3F61D84B5498013b0981537DBef28b73", // relayer
  "0xfB7e93f580d95c86973ae428b470368c355848b4", // arc-canteen test wallet
  SENDSURE_AGENTS.circleAgentWallet,
  "0x1222c4c16376961881cdcfffd6d737137f425dc3", // the Circle agent wallet's backing EOA (pays x402 calls)
  SENDSURE_AGENTS.serverAgent,
];

export function firstParty(): Set<string> {
  const extra = (process.env.FIRST_PARTY_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...BUILT_IN, ...extra].map((a) => a.toLowerCase()));
}

export type Tier = "external" | "first-party" | "sandbox";
export const tierOf = (tier: number, owner: string, ours: Set<string>): Tier =>
  tier === 2 ? "sandbox" : ours.has(owner.toLowerCase()) ? "first-party" : "external";

interface Bucket {
  orgs: number;
  payeesBound: number;
  payments: number;
  paidUsdc: string;
  escalations: number;
  refusals: number;
  cosigns: number;
  anchors: number;
}

export async function stats() {
  const db = await getDb();
  const ours = firstParty();
  const orgs = await db.all<{ org: Address; owner: Address; tier: number }>("SELECT org, owner, tier FROM chain_orgs");
  const tierByOrg = new Map(orgs.map((o) => [o.org.toLowerCase(), tierOf(o.tier, o.owner, ours)]));
  const empty = (): Bucket & { paid: bigint } => ({
    orgs: 0,
    payeesBound: 0,
    payments: 0,
    paidUsdc: "0",
    paid: 0n,
    escalations: 0,
    refusals: 0,
    cosigns: 0,
    anchors: 0,
  });
  const buckets: Record<Tier, Bucket & { paid: bigint }> = { external: empty(), "first-party": empty(), sandbox: empty() };
  for (const t of tierByOrg.values()) buckets[t].orgs++;

  const counts = await db.all<{ org: string; name: string; n: number; total: string | null }>(
    "SELECT org, name, count(*) AS n, CAST(sum(CAST(amount AS INTEGER)) AS TEXT) AS total FROM chain_events GROUP BY org, name",
  );
  const bound = await db.all<{ org: string; n: number }>(
    "SELECT org, count(DISTINCT payee_ref) AS n FROM chain_events WHERE name = 'Bound' GROUP BY org",
  );
  for (const b of bound) {
    const t = tierByOrg.get(b.org.toLowerCase());
    if (t) buckets[t].payeesBound += b.n;
  }
  for (const c of counts) {
    const t = tierByOrg.get(c.org?.toLowerCase() ?? "");
    if (!t) continue;
    const bucket = buckets[t];
    if (c.name === "Settled") {
      bucket.payments += c.n;
      bucket.paid += BigInt(c.total ?? "0");
    } else if (c.name === "Escalated") bucket.escalations += c.n;
    else if (c.name === "Refused") bucket.refusals += c.n;
    else if (c.name === "Cosigned") bucket.cosigns += c.n;
    else if (c.name === "Anchored") bucket.anchors += c.n;
  }
  const recent = await db.all<{ tx: string; block: number; org: string; payout: string; amount: string }>(
    "SELECT tx, block, org, payout, amount FROM chain_events WHERE name = 'Settled' ORDER BY block DESC LIMIT 20",
  );
  // Paid agent calls (x402 over Circle Gateway): other agents paying SendSure per call.
  const x402 = await db.all<{ payer: string; endpoint: string; n: number; total: string | null }>(
    "SELECT payer, endpoint, count(*) AS n, CAST(sum(CAST(amount AS INTEGER)) AS TEXT) AS total FROM x402_payments GROUP BY payer, endpoint",
  );
  const paidCalls = { external: { calls: 0, usdc: 0n, payers: new Set<string>() }, "first-party": { calls: 0, usdc: 0n, payers: new Set<string>() } };
  const byEndpoint: Record<string, number> = {};
  for (const r of x402) {
    const b = paidCalls[ours.has(r.payer.toLowerCase()) ? "first-party" : "external"];
    b.calls += r.n;
    b.usdc += BigInt(r.total ?? "0");
    b.payers.add(r.payer.toLowerCase());
    byEndpoint[r.endpoint] = (byEndpoint[r.endpoint] ?? 0) + r.n;
  }
  // Agent runs come from SendSure's own log (their decisions are what gets anchored on-chain).
  const runRows = await db.all<{ org: string; n: number; auto: number }>(
    `SELECT org, count(*) AS n, sum(CASE WHEN detail LIKE '%"trigger":"autopilot"%' THEN 1 ELSE 0 END) AS auto
     FROM runs WHERE finished_at IS NOT NULL GROUP BY org`,
  );
  const agentRuns: Record<Tier, { runs: number; byAutopilot: number }> = {
    external: { runs: 0, byAutopilot: 0 },
    "first-party": { runs: 0, byAutopilot: 0 },
    sandbox: { runs: 0, byAutopilot: 0 },
  };
  for (const r of runRows) {
    const t = tierByOrg.get(r.org.toLowerCase());
    if (!t) continue;
    agentRuns[t].runs += r.n;
    agentRuns[t].byAutopilot += r.auto ?? 0;
  }
  const out = Object.fromEntries(
    Object.entries(buckets).map(([k, { paid, ...b }]) => [k, { ...b, paidUsdc: formatUsdc(paid) }]),
  ) as Record<Tier, Bucket>;
  return {
    tiers: out,
    agentRuns,
    paidCalls: {
      external: { calls: paidCalls.external.calls, usdc: formatUsdc(paidCalls.external.usdc), payers: paidCalls.external.payers.size },
      firstParty: {
        calls: paidCalls["first-party"].calls,
        usdc: formatUsdc(paidCalls["first-party"].usdc),
        payers: paidCalls["first-party"].payers.size,
      },
      byEndpoint,
    },
    recentPayments: recent.map((r) => ({
      ...r,
      amountUsdc: formatUsdc(BigInt(r.amount)),
      tier: tierByOrg.get(r.org.toLowerCase()) ?? "sandbox",
    })),
  };
}
