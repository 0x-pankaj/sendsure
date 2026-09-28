import type { Address } from "viem";
import { isOwnerOrApprover } from "../../../../lib/claims";
import { getDb } from "../../../../lib/db";
import { verifyChain } from "../../../../lib/decisionLog";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, toAddress } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** ?org=0x… The last runs with their decisions, the latest anchor, and whether the log is intact. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-runs", 120);
    const who = await requireSession(req);
    const org: Address = toAddress(new URL(req.url).searchParams.get("org"), "org");
    if (!(await isOwnerOrApprover(org, who)))
      throw new RelayError(403, "Only the org's owner or an approver can see agent runs.", "FORBIDDEN");
    const db = await getDb();
    const runs = await db.all(
      "SELECT run_id, planner, executor, summary, started_at, finished_at FROM runs WHERE org = ? ORDER BY started_at DESC LIMIT 10",
      org,
    );
    const decisions = await db.all(
      `SELECT seq, run_id, claim_id, action, reason, rule_outcome, rule_reason, hash, tx_hash, tx_outcome, created_at
       FROM decisions WHERE org = ? ORDER BY seq DESC LIMIT 100`,
      org,
    );
    const anchor = await db.first(
      "SELECT anchor_seq, decision_seq, head, tx_hash, created_at FROM anchors WHERE org = ? ORDER BY anchor_seq DESC LIMIT 1",
      org,
    );
    const broken = await verifyChain(db, org);
    return { runs, decisions, anchor, logIntact: broken === null, brokenAt: broken };
  });
}
