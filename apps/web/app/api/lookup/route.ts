import { limitIp, respond } from "../../../lib/http";
import { lookupPayee } from "../../../lib/lookup";
import { toAddress } from "../../../lib/relayer";

export const dynamic = "force-dynamic";

/** ?org=0x…&address=0x… Free, rate-limited lookup for people (agents: see /api/x402). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "lookup", 60);
    const q = new URL(req.url).searchParams;
    return lookupPayee(toAddress(q.get("org"), "org"), toAddress(q.get("address"), "address"));
  });
}
