import { limitIp, respond } from "../../../../../lib/http";
import { requireKey, withdrawBill } from "../../../../../lib/integrations";

export const dynamic = "force-dynamic";

/** Integration key: { external_id }. The bill was cancelled in the books: SendSure will not pay it (409 if already paid). */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "v1-bills", 120);
    const { org } = await requireKey(req);
    return withdrawBill(org, await req.json().catch(() => null));
  });
}
