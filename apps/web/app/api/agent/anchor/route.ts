import type { Hex } from "viem";
import { anchorPlan, recordAnchor } from "../../../../lib/agent";
import { isAgentOf, isOwnerOrApprover } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, toAddress, toObject } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

async function authorize(req: Request, orgParam: unknown) {
  const who = await requireSession(req);
  const org = toAddress(orgParam, "org");
  if (!(await isAgentOf(org, who)) && !(await isOwnerOrApprover(org, who)))
    throw new RelayError(403, "Not allowed for this org.", "FORBIDDEN");
  return org;
}

/** ?org=0x… The anchor the Circle agent wallet should send next ({ head, anchorSeq }), or null. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-anchor", 60);
    return { plan: await anchorPlan(await authorize(req, new URL(req.url).searchParams.get("org"))) };
  });
}

/** { org, txHash }: record an anchor() the Circle agent wallet sent, after checking it on-chain. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-anchor", 60);
    const b = toObject(await req.json().catch(() => null));
    const org = await authorize(req, b.org);
    if (typeof b.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash))
      throw new RelayError(400, "txHash is required.", "BAD_INPUT");
    try {
      return await recordAnchor(org, b.txHash as Hex);
    } catch (err) {
      throw new RelayError(400, String(err instanceof Error ? err.message : err), "NOT_RECORDED");
    }
  });
}
