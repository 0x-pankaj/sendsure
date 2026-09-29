import { getDb } from "../../../../lib/db";
import { limitIp, respond } from "../../../../lib/http";
import { indexerTick } from "../../../../lib/indexer";
import { toAddress } from "../../../../lib/relayer";

export const dynamic = "force-dynamic";

/** ?owner=0x… Orgs the SendSure factory created for this owner (public chain facts). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "org-mine", 60);
    const owner = toAddress(new URL(req.url).searchParams.get("owner"), "owner");
    await indexerTick({ maxWindows: 3, minIntervalSec: 5 }).catch(() => null);
    const db = await getDb();
    const orgs = await db.all<{ org: string; tier: number; block: number; tx: string }>(
      "SELECT org, tier, block, tx FROM chain_orgs WHERE lower(owner) = lower(?) ORDER BY block DESC LIMIT 20",
      owner,
    );
    return { owner, orgs };
  });
}
