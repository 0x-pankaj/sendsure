import { limitIp, respond } from "../../../lib/http";
import { saveLead } from "../../../lib/notify";

export const dynamic = "force-dynamic";

/** "Get set up": { team, contact, paysIn?, payees?, nextPayout?, note?, source, consent: true }. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "leads", 5, 60 * 60_000);
    return saveLead(await req.json().catch(() => null));
  });
}
