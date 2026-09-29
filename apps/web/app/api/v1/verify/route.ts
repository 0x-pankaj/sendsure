import { limitIp, respond } from "../../../../lib/http";
import { requireKey, verifyAddress } from "../../../../lib/integrations";

export const dynamic = "force-dynamic";

/** Integration key: ?address=0x… Is this an address a payee of this org proved, right now? */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "v1", 600);
    return verifyAddress((await requireKey(req)).org, new URL(req.url).searchParams.get("address"));
  });
}
