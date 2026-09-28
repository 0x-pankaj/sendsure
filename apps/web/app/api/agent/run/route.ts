import { runAgent } from "../../../../lib/agent";
import { isOwnerOrApprover } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, allow, toAddress, toObject } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

/** The org's owner or an approver runs the agent now: { org, execute?: boolean }. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-run", 20);
    const who = await requireSession(req);
    const b = toObject(await req.json().catch(() => null));
    const org = toAddress(b.org, "org");
    if (!(await isOwnerOrApprover(org, who)))
      throw new RelayError(403, "Only the org's owner or an approver can run the agent.", "FORBIDDEN");
    if (!allow(`agent-run:${org}`, 12, 60 * 60_000))
      throw new RelayError(429, "The agent ran many times this hour. Please wait a bit.", "RATE_LIMITED");
    return runAgent(org, { execute: b.execute !== false });
  });
}
