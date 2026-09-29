import { limitIp, respond } from "../../../../lib/http";
import { orgInfo, requireKey } from "../../../../lib/integrations";

export const dynamic = "force-dynamic";

/** Integration key: which org this key belongs to (used to test a connection). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "v1", 600);
    return orgInfo((await requireKey(req)).org);
  });
}
