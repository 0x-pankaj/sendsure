import { limitIp, respond } from "../../../lib/http";
import { listProposals } from "../../../lib/invoices";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/** ?org=0x…[&ref=0x…] Invoices read with AI, waiting for (or confirmed by) payees. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "invoices-list", 120);
    const q = new URL(req.url).searchParams;
    return listProposals(await requireSession(req), q.get("org"), q.get("ref"));
  });
}
