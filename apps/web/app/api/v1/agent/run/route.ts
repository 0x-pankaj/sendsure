import { limitIp, respond } from "../../../../../lib/http";
import { requireKey, runAgentForKey } from "../../../../../lib/integrations";

export const dynamic = "force-dynamic";

/** Integration key: run the agent now. It pays only claims that pass the contract; a key cannot co-sign. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-run", 20);
    return runAgentForKey((await requireKey(req)).org);
  });
}
