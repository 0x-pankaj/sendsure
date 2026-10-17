// Server only. Traction numbers, counted only from indexed chain events, in three tiers:
//   external    production orgs whose owner is not one of ours: the only tier that counts as traction
//   first-party production orgs owned by our own keys (demos, dogfooding)
//   sandbox     tier-SANDBOX orgs (tests, judges' test wallets): never counted
import type { Address } from "viem";
import { SENDSURE_AGENT_LIST, formatUsdc } from "@sendsure/chain";
import { getDb } from "./db";
import { usageTotals } from "./notify";

/** Our own keys. Add more with FIRST_PARTY_ADDRESSES (comma-separated), e.g. Pankaj's own wallet. */
const BUILT_IN = [
  "0x38B01c787BFbA932d4601f0f761C950930700809", // deployer (test payer)
  "0x2c623fd23e9cEfE6EE655859a40a93ea9B7A80AC", // approver (test)
  "0x3460E7c7aA9439db630eAf9468653920e9900Dad", // smoke-test payee
  "0x1B66e68D3F61D84B5498013b0981537DBef28b73", // relayer
  "0xfB7e93f580d95c86973ae428b470368c355848b4", // arc-canteen test wallet
  "0x1222c4c16376961881cdcfffd6d737137f425dc3", // the Circle agent wallet's backing EOA (pays x402 calls)
  "0x000E2DD8c423637Ce7AFb28559419080b3c34b05", // mainnet deployer
  "0x51c38105b546bE9BD7cD420743778Dc74f89Cf19", // mainnet relayer
  ...SENDSURE_AGENT_LIST,
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

export interface AgentQuality {
  decisions: number;
  /** Decisions the model reviewed (it is asked only when there is something to decide). */
  reviewed: number;
  agreed: number;
  /** The model held or escalated what the rules would have paid or escalated: its view was used. */
  moreCareful: number;
  /** The model would have paid what the rules held back: overruled, by design. */
  overruled: number;
}
const noQuality = (): AgentQuality => ({ decisions: 0, reviewed: 0, agreed: 0, moreCareful: 0, overruled: 0 });
const RANK: Record<string, number> = { pay: 0, escalate: 1, hold: 2, close: 3 };

/** Adds `n` decisions where the rules said `rules` and the model said `model` (null: not asked). */
export function addQuality(q: AgentQuality, rules: string | null, model: string | null, n: number): void {
  q.decisions += n;
  if (!model || !rules || !(model in RANK) || !(rules in RANK)) return;
  q.reviewed += n;
  if (RANK[model] === RANK[rules]) q.agreed += n;
  else if (RANK[model]! > RANK[rules]!) q.moreCareful += n;
  else q.overruled += n;
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
  // How the model's view compared with the rules', from every logged decision. The model can only make a
  // decision more careful: when it wanted to pay what the rules held back, the rules won.
  const views = await db.all<{ org: string; rules: string | null; model: string | null; n: number }>(
    `SELECT org, json_extract(record, '$.rules.action') AS rules, json_extract(record, '$.model.action') AS model, count(*) AS n
     FROM decisions GROUP BY org, rules, model`,
  );
  const agentQuality: Record<Tier, AgentQuality> = { external: noQuality(), "first-party": noQuality(), sandbox: noQuality() };
  for (const v of views) {
    const t = tierByOrg.get(v.org.toLowerCase());
    if (t) addQuality(agentQuality[t], v.rules, v.model, v.n);
  }
  const out = Object.fromEntries(
    Object.entries(buckets).map(([k, { paid, ...b }]) => [k, { ...b, paidUsdc: formatUsdc(paid) }]),
  ) as Record<Tier, Bucket>;
  return {
    tiers: out,
    agentRuns,
    agentQuality,
    usage: await usageTotals().catch(() => ({})),
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

interface Listed {
  orgs: { org: string; owner: string; block: number; tx: string }[];
  payeesBound: { org: string; payeeRef: string; payout: string | null; block: number; tx: string }[];
  payments: { org: string; payout: string | null; amountUsdc: string; claimId: string | null; decisionHash: string | null; block: number; tx: string; receipt: string }[];
  cosigns: { org: string; claimId: string | null; block: number; tx: string }[];
  anchors: { org: string; head: string | null; block: number; tx: string }[];
}

/**
 * The evidence behind the dashboard: every counted org, proven payee, payment, co-sign and anchored decision-log
 * head, each with its Arc transaction, for outside teams and our own (first-party). Our tests (sandbox) are only
 * counted. Everything listed is already public on Arc; no names, invoices or descriptions.
 */
export async function evidence(origin: string) {
  const db = await getDb();
  const ours = firstParty();
  const orgs = await db.all<{ org: Address; owner: Address; tier: number; block: number; tx: string }>(
    "SELECT org, owner, tier, block, tx FROM chain_orgs ORDER BY block",
  );
  const tierByOrg = new Map(orgs.map((o) => [o.org.toLowerCase(), tierOf(o.tier, o.owner, ours)]));
  const listed = (org: string | null) => {
    const t = tierByOrg.get((org ?? "").toLowerCase());
    return t === "external" || t === "first-party" ? t : null;
  };
  const empty = (): Listed => ({ orgs: [], payeesBound: [], payments: [], cosigns: [], anchors: [] });
  const tiers: Record<"external" | "first-party", Listed> = { external: empty(), "first-party": empty() };
  for (const o of orgs) {
    const t = listed(o.org);
    if (t) tiers[t].orgs.push({ org: o.org, owner: o.owner, block: o.block, tx: o.tx });
  }
  const events = await db.all<{
    tx: string;
    block: number;
    org: string | null;
    name: string;
    payee_ref: string | null;
    claim_id: string | null;
    payout: string | null;
    amount: string | null;
    decision_hash: string | null;
  }>(
    `SELECT tx, block, org, name, payee_ref, claim_id, payout, amount, decision_hash FROM chain_events
     WHERE name IN ('Bound', 'Settled', 'Cosigned', 'Anchored') ORDER BY block, log_index`,
  );
  for (const e of events) {
    const t = listed(e.org);
    if (!t || !e.org) continue;
    const at = { block: e.block, tx: e.tx };
    if (e.name === "Bound") tiers[t].payeesBound.push({ org: e.org, payeeRef: e.payee_ref ?? "", payout: e.payout, ...at });
    else if (e.name === "Settled")
      tiers[t].payments.push({
        org: e.org,
        payout: e.payout,
        amountUsdc: formatUsdc(BigInt(e.amount ?? "0")),
        claimId: e.claim_id,
        decisionHash: e.decision_hash,
        ...at,
        receipt: `${origin}/receipt?tx=${e.tx}`,
      });
    else if (e.name === "Cosigned") tiers[t].cosigns.push({ org: e.org, claimId: e.claim_id, ...at });
    else tiers[t].anchors.push({ org: e.org, head: e.decision_hash, ...at });
  }
  const totals = (await stats()).tiers;
  return {
    note:
      "Counted from SendSure's contracts on Arc testnet. external = orgs whose owner is not one of SendSure's own wallets " +
      "(the only tier that counts as traction); first-party = our own wallets; sandbox = our tests, counted but not listed.",
    explorerTx: "https://explorer.testnet.arc.io/tx/",
    firstPartyWallets: [...ours],
    totals,
    tiers,
  };
}
