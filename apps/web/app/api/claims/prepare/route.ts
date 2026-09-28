import { prepareClaim } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { requireSession } from "../../../../lib/session";

/** A signed-in payee asks for the invoice's refHash and a nonce, then signs the Claim. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "claims-prepare", 30);
    return prepareClaim(await requireSession(req), await req.json().catch(() => null));
  });
}
