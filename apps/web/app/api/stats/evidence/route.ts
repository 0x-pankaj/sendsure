import { limitIp, respond } from "../../../../lib/http";
import { evidence } from "../../../../lib/stats";

export const dynamic = "force-dynamic";

/** Every counted org, payee and payment behind /dashboard, with its Arc transaction (sandbox only counted). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "stats-evidence", 20);
    return evidence(new URL(req.url).origin);
  });
}
