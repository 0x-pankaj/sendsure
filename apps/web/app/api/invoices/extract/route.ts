import { limitIp, respond } from "../../../../lib/http";
import { extractInvoice } from "../../../../lib/invoices";
import { RelayError, allow } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

/** { org, payeeRef, text? | image? } The payer's invoice, read by Claude via MeshAPI into a proposal. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "invoices-extract", 20);
    if (!allow("invoices-extract:day", 300, 24 * 60 * 60_000))
      throw new RelayError(429, "Invoice reading is busy today. Please try tomorrow.", "RATE_LIMITED");
    return extractInvoice(await requireSession(req), await req.json().catch(() => null));
  });
}
