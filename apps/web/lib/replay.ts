// Server only. Replays one logged decision WITHOUT asking the model again:
//   - the hash chain up to it is intact
//   - the stored claim still hashes to the claimId the payee signed, and the signature is the payout's
//   - the contract's check() at the recorded block gives the recorded outcome and reason
//   - if it was paid, the on-chain event carries this decision's hash
//   - an on-chain anchor covers it, with the same head
import { getAddress, parseEventLogs, recoverAddress, type Address, type Hex } from "viem";
import { OUTCOMES, REASONS, claimIdOf, encodeClaim, mandateAbi, type Claim } from "@sendsure/chain";
import { getDb } from "./db";
import { GENESIS, chainHash } from "./decisionLog";
import { RelayError, serverClient } from "./relayer";

interface DecisionRow {
  seq: number;
  claim_id: Hex;
  action: string;
  reason: string;
  rule_outcome: string;
  rule_reason: string;
  block_number: number;
  record: string;
  prev_hash: Hex;
  hash: Hex;
  tx_hash: Hex | null;
}

export async function replayDecision(org: Address, seq: number) {
  const db = await getDb();
  const d = await db.first<DecisionRow>("SELECT * FROM decisions WHERE org = ? AND seq = ?", org, seq);
  if (!d) throw new RelayError(404, "No such decision.", "NOT_FOUND");

  const chain = await db.all<{ seq: number; record: string; prev_hash: Hex; hash: Hex }>(
    "SELECT seq, record, prev_hash, hash FROM decisions WHERE org = ? ORDER BY seq",
    org,
  );
  let prev = GENESIS;
  let intactThrough = 0;
  for (const r of chain) {
    if (r.prev_hash !== prev || chainHash(prev, r.record) !== r.hash) break;
    prev = r.hash;
    intactThrough = r.seq;
  }

  const c = await db.first<Record<string, string | number>>("SELECT * FROM claims WHERE claim_id = ?", d.claim_id);
  if (!c) throw new RelayError(404, "The claim for this decision is missing.", "NOT_FOUND");
  const claim: Claim = {
    payeeRef: c.payee_ref as Hex,
    token: c.token as Address,
    amount: BigInt(c.amount!),
    refHash: c.ref_hash as Hex,
    periodStart: BigInt(c.period_start!),
    periodEnd: BigInt(c.period_end!),
    nonce: BigInt(c.nonce!),
    validUntil: BigInt(c.valid_until!),
  };
  const claimId = claimIdOf(org, claim);
  const record = JSON.parse(d.record) as { claim?: { payout?: string } };
  const signer = await recoverAddress({ hash: claimId, signature: c.payee_sig as Hex }).catch(() => null);
  const signatureOk = claimId === d.claim_id && Boolean(signer) && signer === getAddress(record.claim?.payout ?? "0x0");

  const [o, r] = await serverClient.readContract({
    address: org,
    abi: mandateAbi,
    functionName: "check",
    args: [encodeClaim(claim), c.payee_sig as Hex],
    blockNumber: BigInt(d.block_number),
  });
  const checkAtBlock = {
    block: d.block_number,
    outcome: OUTCOMES[o],
    reason: REASONS[r],
    matches: OUTCOMES[o] === d.rule_outcome && REASONS[r] === d.rule_reason,
  };

  let payment: { tx: Hex; event: string | null; carriesDecisionHash: boolean } | null = null;
  if (d.tx_hash) {
    const receipt = await serverClient.getTransactionReceipt({ hash: d.tx_hash });
    const events = parseEventLogs({
      abi: mandateAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === org.toLowerCase()),
    });
    const ev = events.find((e) => "decisionHash" in e.args && (e.args as { decisionHash: Hex }).decisionHash === d.hash);
    payment = { tx: d.tx_hash, event: ev?.eventName ?? null, carriesDecisionHash: Boolean(ev) };
  }

  const anchor = await db.first<{ anchor_seq: number; decision_seq: number; head: Hex; tx_hash: Hex }>(
    "SELECT anchor_seq, decision_seq, head, tx_hash FROM anchors WHERE org = ? AND decision_seq >= ? ORDER BY anchor_seq LIMIT 1",
    org,
    seq,
  );
  let anchored: { anchorSeq: number; tx: Hex; coversThrough: number; matches: boolean } | null = null;
  if (anchor) {
    const receipt = await serverClient.getTransactionReceipt({ hash: anchor.tx_hash });
    const [ev] = parseEventLogs({ abi: mandateAbi, logs: receipt.logs, eventName: "Anchored" });
    const headRow = chain.find((x) => x.seq === anchor.decision_seq);
    anchored = {
      anchorSeq: anchor.anchor_seq,
      tx: anchor.tx_hash,
      coversThrough: anchor.decision_seq,
      matches: Boolean(ev) && ev!.args.head === headRow?.hash && intactThrough >= anchor.decision_seq,
    };
  }

  return {
    seq,
    claimId: d.claim_id,
    action: d.action,
    reason: d.reason,
    chainIntact: intactThrough >= seq,
    signatureOk,
    checkAtBlock,
    payment,
    anchored,
    modelAskedAgain: false,
  };
}
