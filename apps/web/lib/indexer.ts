// Server only. Indexes our contracts' events into D1, in windows of at most 9,999 blocks from a cursor.
// Safe to run concurrently: inserts are idempotent (tx + log index) and the cursor only moves forward.
import type { AbiEvent, Address, Hex } from "viem";
import { deployment, mandateAbi, mandateFactoryAbi, payeeRegistryAbi } from "@sendsure/chain";
import { getDb } from "./db";
import { serverClient } from "./relayer";

export const DEPLOY_BLOCK = 64_484_273n;
const WINDOW = 9_999n;
const pick = (abi: readonly unknown[], names: string[]) =>
  (abi as AbiEvent[]).filter((x) => x.type === "event" && names.includes(x.name));
const FACTORY_EVENTS = pick(mandateFactoryAbi, ["MandateCreated"]);
const REGISTRY_EVENTS = pick(payeeRegistryAbi, ["Bound", "Changed", "Revoked", "Frozen", "Unfrozen"]);
const MANDATE_EVENTS = pick(mandateAbi, ["Settled", "Escalated", "Refused", "AlreadySettled", "Cosigned", "Anchored"]);

interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  address: Address;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
}

const str = (v: unknown) => (v === undefined || v === null ? null : String(v));

/** Runs up to `maxWindows` windows if the cursor is older than `minIntervalSec`. Returns the cursor. */
export async function indexerTick(opts: { maxWindows?: number; minIntervalSec?: number } = {}) {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const cur = await db.first<{ block: number; updated_at: number }>(
    "SELECT block, updated_at FROM indexer_cursor WHERE name = 'main'",
  );
  if (cur && now - cur.updated_at < (opts.minIntervalSec ?? 0))
    return { block: cur.block, updatedAt: cur.updated_at, ran: false };
  const latest = (await serverClient.getBlockNumber()) - 2n;
  let from = cur ? BigInt(cur.block) + 1n : DEPLOY_BLOCK;
  let windows = 0;
  while (from <= latest && windows < (opts.maxWindows ?? 3)) {
    const to = from + WINDOW - 1n > latest ? latest : from + WINDOW - 1n;
    const created = (await serverClient.getLogs({
      address: deployment.mandateFactory as Address,
      events: FACTORY_EVENTS,
      fromBlock: from,
      toBlock: to,
    })) as unknown as DecodedLog[];
    for (const l of created) {
      await db.run(
        "INSERT OR IGNORE INTO chain_orgs (org, owner, treasury, tier, block, tx) VALUES (?, ?, ?, ?, ?, ?)",
        l.args.org,
        l.args.owner,
        l.args.treasury,
        Number(l.args.tier),
        Number(l.blockNumber),
        l.transactionHash,
      );
    }
    const orgs = (await db.all<{ org: Address }>("SELECT org FROM chain_orgs")).map((r) => r.org);
    const logs: DecodedLog[] = [
      ...((await serverClient.getLogs({
        address: deployment.payeeRegistry as Address,
        events: REGISTRY_EVENTS,
        fromBlock: from,
        toBlock: to,
      })) as unknown as DecodedLog[]),
    ];
    for (let i = 0; i < orgs.length; i += 100) {
      logs.push(
        ...((await serverClient.getLogs({
          address: orgs.slice(i, i + 100),
          events: MANDATE_EVENTS,
          fromBlock: from,
          toBlock: to,
        })) as unknown as DecodedLog[]),
      );
    }
    for (const l of logs) {
      const a = l.args;
      const isRegistry = l.address.toLowerCase() === deployment.payeeRegistry.toLowerCase();
      await db.run(
        `INSERT OR IGNORE INTO chain_events (tx, log_index, block, address, name, org, payee_ref, claim_id, payout, amount, reason, decision_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        l.transactionHash,
        l.logIndex,
        Number(l.blockNumber),
        l.address,
        l.eventName,
        isRegistry ? str(a.org) : l.address,
        str(a.payeeRef),
        str(a.claimId),
        str(a.payout ?? a.newPayout),
        str(a.amount),
        a.reason === undefined ? null : Number(a.reason),
        str(a.decisionHash ?? a.head),
      );
    }
    await db.run(
      `INSERT INTO indexer_cursor (name, block, updated_at) VALUES ('main', ?, ?)
       ON CONFLICT(name) DO UPDATE SET block = max(block, excluded.block), updated_at = excluded.updated_at`,
      Number(to),
      now,
    );
    from = to + 1n;
    windows++;
  }
  return { block: Number(from - 1n), updatedAt: now, ran: true, behind: Number(latest - (from - 1n)) };
}
