import { isOwnerOrApprover } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, toAddress, toUint } from "../../../../lib/relayer";
import { replayDecision } from "../../../../lib/replay";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** ?org=0x…&seq=N Re-verify one logged decision from the chain; the model is never asked again. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-replay", 60);
    const who = await requireSession(req);
    const q = new URL(req.url).searchParams;
    const org = toAddress(q.get("org"), "org");
    if (!(await isOwnerOrApprover(org, who)))
      throw new RelayError(403, "Only the org's owner or an approver can replay decisions.", "FORBIDDEN");
    return replayDecision(org, Number(toUint(q.get("seq") ?? undefined, 32, "seq")));
  });
}
