// Server only. A public receipt for one SendSure payment, from on-chain facts only (no invoice
// numbers or reasons: those stay private to the payer and payee).
import { formatUnits, parseEventLogs, type Address, type Hex } from "viem";
import { deployment, mandateAbi, mandateFactoryAbi } from "@sendsure/chain";
import { getDb } from "./db";
import { indexerTick } from "./indexer";
import { RelayError, serverClient } from "./relayer";
import { firstParty, tierOf } from "./stats";

export async function receiptFor(txHash: Hex) {
  const r = await serverClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!r) throw new RelayError(404, "No such transaction on Arc testnet.", "NOT_FOUND");
  const ev = parseEventLogs({ abi: mandateAbi, logs: r.logs, eventName: "Settled" })[0];
  if (!ev) throw new RelayError(404, "This transaction has no SendSure payment.", "NOT_FOUND");
  const org = ev.address as Address;
  // Only contracts our factory created count: anyone could deploy a look-alike that emits "Settled".
  const isMandate = await serverClient.readContract({
    address: deployment.mandateFactory as Address,
    abi: mandateFactoryAbi,
    functionName: "isMandate",
    args: [org],
  });
  if (!isMandate) throw new RelayError(404, "This payment was not made by a SendSure org.", "NOT_FOUND");
  const [block, owner, tier] = await Promise.all([
    serverClient.getBlock({ blockNumber: r.blockNumber }),
    serverClient.readContract({ address: org, abi: mandateAbi, functionName: "owner" }),
    serverClient.readContract({ address: org, abi: mandateAbi, functionName: "tier" }),
  ]);
  await indexerTick({ maxWindows: 3, minIntervalSec: 20 }).catch(() => null);
  const db = await getDb();
  const proof = await db.first<{ tx: Hex; block: number; name: string }>(
    `SELECT tx, block, name FROM chain_events WHERE name IN ('Bound', 'Changed') AND lower(org) = lower(?) AND lower(payee_ref) = lower(?)
       AND lower(payout) = lower(?) AND block <= ? ORDER BY block DESC LIMIT 1`,
    org,
    ev.args.payeeRef,
    ev.args.payout,
    Number(r.blockNumber),
  );
  const decision = await db.first<{ seq: number }>("SELECT seq FROM decisions WHERE hash = ?", ev.args.decisionHash);
  const anchor = decision
    ? await db.first<{ anchor_seq: number; tx_hash: Hex }>(
        "SELECT anchor_seq, tx_hash FROM anchors WHERE lower(org) = lower(?) AND decision_seq >= ? ORDER BY anchor_seq LIMIT 1",
        org,
        decision.seq,
      )
    : null;
  return {
    tx: txHash,
    org,
    tier: tierOf(Number(tier), owner, firstParty()),
    payout: ev.args.payout,
    amountUsdc: formatUnits(ev.args.amount, 6),
    time: new Date(Number(block.timestamp) * 1000).toISOString(),
    block: r.blockNumber.toString(),
    claimId: ev.args.claimId,
    decisionHash: ev.args.decisionHash,
    addressProof: proof ? { tx: proof.tx, block: proof.block, kind: proof.name } : null,
    anchor: anchor ? { seq: anchor.anchor_seq, tx: anchor.tx_hash } : null,
  };
}
