// Server only. The hash-chained decision log. Each record's hash is the decisionHash passed to
// settle(), and the head is anchored on-chain with Mandate.anchor, so a decision cannot be edited
// after the fact without breaking the chain.
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import type { Db } from "./db";

export const GENESIS: Hex = `0x${"00".repeat(32)}`;

/** JSON with sorted keys and bigints as strings: the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

export const chainHash = (prevHash: Hex, record: string): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [prevHash, keccak256(toBytes(record))]));

export interface DecisionInput {
  org: Address;
  runId: string;
  claimId: Hex;
  action: string;
  reason: string;
  ruleOutcome: string;
  ruleReason: string;
  blockNumber: bigint;
  record: Record<string, unknown>;
}

export async function head(db: Db, org: Address): Promise<{ seq: number; hash: Hex }> {
  const row = await db.first<{ seq: number; hash: Hex }>(
    "SELECT seq, hash FROM decisions WHERE org = ? ORDER BY seq DESC LIMIT 1",
    org,
  );
  return row ?? { seq: 0, hash: GENESIS };
}

/** Appends one decision. Retries if another run appended at the same moment (the PK is org+seq). */
export async function appendDecision(db: Db, d: DecisionInput): Promise<{ seq: number; hash: Hex; prevHash: Hex }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const prev = await head(db, d.org);
    const seq = prev.seq + 1;
    const record = canonicalJson({ ...d.record, v: 1, org: d.org, seq, runId: d.runId, claimId: d.claimId, prevHash: prev.hash });
    const hash = chainHash(prev.hash, record);
    try {
      await db.run(
        `INSERT INTO decisions (org, seq, run_id, claim_id, action, reason, rule_outcome, rule_reason, block_number, record, prev_hash, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.org,
        seq,
        d.runId,
        d.claimId,
        d.action,
        d.reason,
        d.ruleOutcome,
        d.ruleReason,
        Number(d.blockNumber),
        record,
        prev.hash,
        hash,
        Math.floor(Date.now() / 1000),
      );
      return { seq, hash, prevHash: prev.hash };
    } catch (err) {
      if (!/UNIQUE|constraint|PRIMARY/i.test(String(err))) throw err;
    }
  }
  throw new Error("decision log is busy; try the run again");
}

/** Recomputes every hash of an org's log: returns the first broken seq, or null if intact. */
export async function verifyChain(db: Db, org: Address): Promise<number | null> {
  const rows = await db.all<{ seq: number; record: string; prev_hash: Hex; hash: Hex }>(
    "SELECT seq, record, prev_hash, hash FROM decisions WHERE org = ? ORDER BY seq",
    org,
  );
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev || chainHash(prev, r.record) !== r.hash) return r.seq;
    prev = r.hash;
  }
  return null;
}
