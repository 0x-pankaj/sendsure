import { limitIp, respond } from "../../../../lib/http";
import { rejectProposal } from "../../../../lib/invoices";
import { requireSession } from "../../../../lib/session";

/** { org, id } The payee (or the payer) says this invoice is wrong or not theirs. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "invoices-reject", 60);
    return rejectProposal(await requireSession(req), await req.json().catch(() => null));
  });
}
