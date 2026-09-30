// Server only. Autopilot: the agent runs on its own schedule for orgs whose owner turned it on.
//
// It gives the agent no new power. Every run is the same runAgent() a person starts by hand: the
// contract's budget, the co-sign rules and the cash plan all apply, and anything that needs a person
// still waits for one. The scheduler only decides WHEN to run: each minute it re-reads every open
// claim's state from the chain (the contract's check(), whether a person co-signed, what the treasury
// can pay) and runs the agent only if something changed since its last run. So a claim waiting for a
// co-sign or for funds costs nothing until the co-sign or the funds arrive.
import { erc20Abi, zeroAddress, type Address, type Hex } from "viem";
import { OUTCOMES, REASONS, deployment, encodeClaim, mandateAbi } from "@sendsure/chain";
import { runAgent } from "./agent";
import { isAgentOf, isOwnerOrApprover } from "./claims";
import { getDb } from "./db";
import { agentWallet } from "./orgRelay";
import { RelayError, serverClient, toAddress, toObject } from "./relayer";

/** No more than one autopilot run per org in this many seconds, and this many a day. */
const MIN_INTERVAL = 120;
const MAX_RUNS_PER_DAY = 60;
const DAY = 86_400;

interface AutopilotRow {
  org: Address;
  enabled: number;
  set_by: Address;
  set_at: number;
  last_tick_at: number | null;
  last_run_at: number | null;
  last_run_id: string | null;
  last_summary: string | null;
  seen: string | null;
}

interface OpenClaim {
  claim_id: Hex;
  payee_ref: Hex;
  token: Address;
  amount: string;
  ref_hash: Hex;
  period_start: number;
  period_end: number;
  nonce: string;
  valid_until: number;
  payee_sig: Hex;
}

export type Seen = Record<string, string>;

/** True if any open claim is new or in a different state than at the last run, or the funds changed. */
export function somethingChanged(seen: Seen, now: Seen): boolean {
  return Object.keys(now).some((k) => seen[k] !== now[k]);
}

/** Each open claim's state at the latest block, plus what the treasury can pay ("cash"). */
async function readState(org: Address): Promise<Seen> {
  const db = await getDb();
  const open = await db.all<OpenClaim>(
    `SELECT claim_id, payee_ref, token, amount, ref_hash, period_start, period_end, nonce, valid_until, payee_sig
     FROM claims WHERE org = ? AND status = 'open' ORDER BY created_at LIMIT 25`,
    org,
  );
  if (!open.length) return {};
  const block = await serverClient.getBlockNumber({ cacheTime: 0 });
  const state: Seen = {};
  await Promise.all(
    open.map(async (c) => {
      const claimHex = encodeClaim({
        payeeRef: c.payee_ref,
        token: c.token,
        amount: BigInt(c.amount),
        refHash: c.ref_hash,
        periodStart: BigInt(c.period_start),
        periodEnd: BigInt(c.period_end),
        nonce: BigInt(c.nonce),
        validUntil: BigInt(c.valid_until),
      });
      const [[o, r], cosignedBy] = await Promise.all([
        serverClient.readContract({ address: org, abi: mandateAbi, functionName: "check", args: [claimHex, c.payee_sig], blockNumber: block }),
        serverClient.readContract({ address: org, abi: mandateAbi, functionName: "cosignedBy", args: [c.claim_id], blockNumber: block }),
      ]);
      state[c.claim_id] = `${OUTCOMES[o] ?? "REFUSED"}:${REASONS[r] ?? "NONE"}:${cosignedBy !== zeroAddress ? "cosigned" : "-"}`;
    }),
  );
  const treasury = await serverClient.readContract({ address: org, abi: mandateAbi, functionName: "treasury", blockNumber: block });
  const usdcToken = { address: deployment.usdc as Address, abi: erc20Abi, blockNumber: block } as const;
  const [balance, allowance] = await Promise.all([
    serverClient.readContract({ ...usdcToken, functionName: "balanceOf", args: [treasury] }),
    serverClient.readContract({ ...usdcToken, functionName: "allowance", args: [treasury, org] }),
  ]);
  state.cash = (balance < allowance ? balance : allowance).toString();
  return state;
}

const parseSeen = (text: string | null): Seen => {
  try {
    return text ? (JSON.parse(text) as Seen) : {};
  } catch {
    return {};
  }
};

export interface TickResult {
  checked: number;
  ran: { org: Address; runId: string; summary: string }[];
  skipped: { org: Address; why: string }[];
}

/** One scheduler tick (the Worker's cron, every minute): run the agent where something changed. */
export async function autopilotTick(opts: { maxOrgs?: number; maxRuns?: number; now?: number } = {}): Promise<TickResult> {
  const db = await getDb();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const rows = await db.all<AutopilotRow>(
    "SELECT * FROM autopilot WHERE enabled = 1 ORDER BY COALESCE(last_tick_at, 0) LIMIT ?",
    opts.maxOrgs ?? 10,
  );
  const out: TickResult = { checked: rows.length, ran: [], skipped: [] };
  for (const row of rows) {
    await db.run("UPDATE autopilot SET last_tick_at = ? WHERE org = ?", now, row.org);
    try {
      const state = await readState(row.org);
      if (!somethingChanged(parseSeen(row.seen), state)) continue;
      if (out.ran.length >= (opts.maxRuns ?? 2)) {
        out.skipped.push({ org: row.org, why: "next tick (this tick already ran its share)" });
        continue;
      }
      if (row.last_run_at && now - row.last_run_at < MIN_INTERVAL) {
        out.skipped.push({ org: row.org, why: "ran less than two minutes ago" });
        continue;
      }
      const today = await db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM runs WHERE org = ? AND started_at > ? AND detail LIKE '%\"trigger\":\"autopilot\"%'",
        row.org,
        now - DAY,
      );
      if ((today?.n ?? 0) >= MAX_RUNS_PER_DAY) {
        out.skipped.push({ org: row.org, why: "daily autopilot limit reached" });
        continue;
      }
      // Take the slot before running: a run can outlast the minute, and the next tick must not start a second one.
      await db.run("UPDATE autopilot SET last_run_at = ? WHERE org = ?", now, row.org);
      const run = await runAgent(row.org, { execute: true, trigger: "autopilot" });
      // Remember the state AFTER the run, so the run's own effects (a payment, less cash) don't start another.
      const after = await readState(row.org);
      await db.run(
        "UPDATE autopilot SET seen = ?, last_run_at = ?, last_run_id = ?, last_summary = ? WHERE org = ?",
        JSON.stringify(after),
        now,
        run.runId,
        run.summary,
        row.org,
      );
      out.ran.push({ org: row.org, runId: run.runId, summary: run.summary });
    } catch (err) {
      // A failing org (RPC trouble, no gas) is tried again in ten minutes, not every minute.
      await db.run("UPDATE autopilot SET last_run_at = ? WHERE org = ?", now + 8 * 60, row.org).catch(() => undefined);
      out.skipped.push({ org: row.org, why: String(err).slice(0, 200) });
    }
  }
  return out;
}

const view = (row: AutopilotRow | null) => ({
  enabled: row?.enabled === 1,
  setBy: row?.set_by ?? null,
  setAt: row?.set_at ?? null,
  lastCheckedAt: row?.last_tick_at ?? null,
  lastRunAt: row?.last_run_at ?? null,
  lastSummary: row?.last_summary ?? null,
});

export async function getAutopilot(session: Address, orgParam: string | null) {
  const org = toAddress(orgParam, "org");
  if (!(await isOwnerOrApprover(org, session)))
    throw new RelayError(403, "Only the org's owner or an approver can see its autopilot.", "FORBIDDEN");
  const db = await getDb();
  return view(await db.first<AutopilotRow>("SELECT * FROM autopilot WHERE org = ?", org));
}

/**
 * Turn autopilot on or off. Body: { org, enabled }. Only the owner can turn it on; the owner or an
 * approver can turn it off (a stop button should never wait for the owner).
 */
export async function setAutopilot(session: Address, body: unknown) {
  const b = toObject(body);
  const org = toAddress(b.org, "org");
  const enabled = b.enabled === true;
  const owner = await serverClient.readContract({ address: org, abi: mandateAbi, functionName: "owner" }).catch(() => null);
  if (!owner) throw new RelayError(404, "That org was not found on Arc.", "NOT_FOUND");
  if (enabled && owner !== session) throw new RelayError(403, "Only the org's owner can turn autopilot on.", "FORBIDDEN");
  if (!enabled && !(await isOwnerOrApprover(org, session)))
    throw new RelayError(403, "Only the org's owner or an approver can turn autopilot off.", "FORBIDDEN");
  if (enabled && !(await isAgentOf(org, agentWallet().account.address)))
    throw new RelayError(409, "SendSure's agent is not an agent of this org, so it cannot pay for it.", "NOT_AGENT");
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  // Turning it on forgets what was seen, so the first tick looks at every open claim afresh.
  await db.run(
    `INSERT INTO autopilot (org, enabled, set_by, set_at, seen) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(org) DO UPDATE SET enabled = excluded.enabled, set_by = excluded.set_by, set_at = excluded.set_at, seen = NULL`,
    org,
    enabled ? 1 : 0,
    session,
    now,
  );
  return view(await db.first<AutopilotRow>("SELECT * FROM autopilot WHERE org = ?", org));
}
