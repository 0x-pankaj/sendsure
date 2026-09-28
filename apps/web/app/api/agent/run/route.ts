import { runAgent } from "../../../../lib/agent";
import { isAgentOf, isOwnerOrApprover } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, allow, toAddress, toObject } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

/**
 * Run the agent now: { org, execute?: boolean }. The owner or an approver may run it with the server
 * agent paying (execute, the default). An agent of the org (the Circle agent wallet) may ask for a
 * plan only (execute: false) and send settle() itself.
 */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-run", 20);
    const who = await requireSession(req);
    const b = toObject(await req.json().catch(() => null));
    const org = toAddress(b.org, "org");
    const execute = b.execute !== false;
    const allowed = (await isOwnerOrApprover(org, who)) || (!execute && (await isAgentOf(org, who)));
    if (!allowed)
      throw new RelayError(403, "Only the org's owner, an approver, or (plan only) its agent can run the agent.", "FORBIDDEN");
    if (!allow(`agent-run:${org}`, 12, 60 * 60_000))
      throw new RelayError(429, "The agent ran many times this hour. Please wait a bit.", "RATE_LIMITED");
    return runAgent(org, { execute });
  });
}
