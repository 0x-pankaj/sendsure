import { limitIp, respond } from "../../../../lib/http";
import { createBill, listBills, requireKey } from "../../../../lib/integrations";

export const dynamic = "force-dynamic";

/**
 * Integration key: send a posted vendor bill. It becomes an invoice the vendor confirms by signing;
 * sending the same bill again returns its status. Body: { system: "odoo", external_id, payee_ref,
 * invoice_ref, amount: "250.00", currency: "USD" | "USDC", invoice_date: "YYYY-MM-DD", description?, document? }.
 */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "v1-bills", 120);
    const { org } = await requireKey(req);
    return createBill(org, await req.json().catch(() => null), new URL(req.url).origin);
  });
}

/** Integration key: ?ids=<external id>,… Each bill's status, down to the settle tx and exact amount paid. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "v1", 600);
    const { org } = await requireKey(req);
    const url = new URL(req.url);
    return listBills(org, url.searchParams.get("ids"), url.origin);
  });
}
