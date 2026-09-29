import { limitIp, respond } from "../../../../lib/http";
import { payees, requireKey } from "../../../../lib/integrations";

export const dynamic = "force-dynamic";

/** Integration key: ?refs=0x…,0x… Each invite's state and the address the payee proved. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "v1", 600);
    return payees((await requireKey(req)).org, new URL(req.url).searchParams.get("refs"));
  });
}
