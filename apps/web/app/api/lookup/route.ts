import type { Address } from "viem";
import { getDb } from "../../../lib/db";
import { limitIp, respond } from "../../../lib/http";
import { indexerTick } from "../../../lib/indexer";
import { readPayee } from "@sendsure/chain";
import { serverClient, toAddress } from "../../../lib/relayer";

export const dynamic = "force-dynamic";

/**
 * ?org=0x…&address=0x… Is this address a payee who proved it for this org, right now?
 * Public, and answers only yes/no with the proof transaction: no names, no amounts.
 */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "lookup", 60);
    const q = new URL(req.url).searchParams;
    const org: Address = toAddress(q.get("org"), "org");
    const address: Address = toAddress(q.get("address"), "address");
    await indexerTick({ maxWindows: 6, minIntervalSec: 10 }).catch(() => null);
    const db = await getDb();
    const candidates = await db.all<{ payee_ref: `0x${string}`; tx: string; block: number }>(
      `SELECT payee_ref, tx, block FROM chain_events WHERE name IN ('Bound', 'Changed') AND lower(org) = lower(?) AND lower(payout) = lower(?)
       ORDER BY block DESC LIMIT 10`,
      org,
      address,
    );
    for (const c of candidates) {
      const p = await readPayee(serverClient, org, c.payee_ref);
      if (p.payout.toLowerCase() === address.toLowerCase() && (p.state === "BOUND" || p.state === "FROZEN")) {
        return { org, address, verified: p.state === "BOUND", state: p.state, tier: p.tier, since: { tx: c.tx, block: c.block } };
      }
    }
    return { org, address, verified: false, state: "NOT_A_PROVEN_PAYEE" };
  });
}
