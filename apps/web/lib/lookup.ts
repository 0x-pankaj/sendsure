// Server only. "Is this address a payee who proved it for this org, right now?" From the chain index
// and the registry itself; answers yes/no with the proof, never names or amounts.
import type { Address, Hex } from "viem";
import { deployment, mandateAbi, mandateFactoryAbi, readPayee } from "@sendsure/chain";
import { getDb } from "./db";
import { indexerTick } from "./indexer";
import { serverClient } from "./relayer";

export async function lookupPayee(org: Address, address: Address) {
  const isOrg = await serverClient
    .readContract({
      address: deployment.mandateFactory as Address,
      abi: mandateFactoryAbi,
      functionName: "isMandate",
      args: [org],
    })
    .catch(() => false);
  if (!isOrg) return { org, address, verified: false, state: "NOT_A_SENDSURE_ORG" as const };
  await indexerTick({ maxWindows: 6, minIntervalSec: 10 }).catch(() => null);
  const db = await getDb();
  const rows = await db.all<{ payee_ref: Hex; tx: string; block: number }>(
    `SELECT payee_ref, tx, block FROM chain_events WHERE name IN ('Bound', 'Changed') AND lower(org) = lower(?) AND lower(payout) = lower(?)
     ORDER BY block DESC LIMIT 10`,
    org,
    address,
  );
  for (const r of rows) {
    const p = await readPayee(serverClient, org, r.payee_ref);
    if (p.payout.toLowerCase() === address.toLowerCase() && (p.state === "BOUND" || p.state === "FROZEN")) {
      const tier = await serverClient.readContract({ address: org, abi: mandateAbi, functionName: "tier" }).catch(() => 0);
      return {
        org,
        address,
        verified: p.state === "BOUND" && !p.changePending,
        state: p.changePending ? "CHANGE_PENDING" : p.state,
        proof: p.tier,
        since: { tx: r.tx, block: r.block },
        orgTier: tier === 2 ? "sandbox" : "production",
      };
    }
  }
  return { org, address, verified: false, state: "NOT_A_PROVEN_PAYEE" as const };
}
