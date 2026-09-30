import { getAutopilot, setAutopilot } from "../../../../lib/autopilot";
import { limitIp, respond } from "../../../../lib/http";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** ?org=0x… Whether the agent runs on its own for this org, and what it last did. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "autopilot", 120);
    return getAutopilot(await requireSession(req), new URL(req.url).searchParams.get("org"));
  });
}

/** Turn autopilot on (owner only) or off (owner or approver). Body: { org, enabled }. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "autopilot-set", 20);
    return setAutopilot(await requireSession(req), await req.json().catch(() => null));
  });
}
