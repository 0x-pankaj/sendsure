import { listClaims, submitClaim } from "../../../lib/claims";
import { limitIp, respond } from "../../../lib/http";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/** Store a claim the payee signed, after the contract's own check() dry run. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "claims-submit", 20);
    return submitClaim(await req.json().catch(() => null));
  });
}

/** ?org=0x…[&ref=0x…] Claims visible to the signed-in address. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "claims-list", 120);
    const q = new URL(req.url).searchParams;
    return listClaims(await requireSession(req), q.get("org"), q.get("ref"));
  });
}
