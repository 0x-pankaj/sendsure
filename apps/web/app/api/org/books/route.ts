import { orgBooks } from "../../../../lib/books";
import { isOwnerOrApprover } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, toAddress } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** ?org=0x… Payments and closing balances from the chain, for the browser's beancount export. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "org-books", 30);
    const who = await requireSession(req);
    const org = toAddress(new URL(req.url).searchParams.get("org"), "org");
    if (!(await isOwnerOrApprover(org, who)))
      throw new RelayError(403, "Only the org's owner or an approver can export its books.", "FORBIDDEN");
    return orgBooks(org);
  });
}
