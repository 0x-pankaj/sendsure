import { limitIp, respond } from "../../../../lib/http";
import { reviewPayout } from "../../../../lib/review";

export const dynamic = "force-dynamic";

/** { current: PayoutRow[], last?: PayoutRow[] } -> the rules' check and Claude's review of every line. Nothing is stored. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "payout-review", 10, 60 * 60_000);
    return reviewPayout(await req.json().catch(() => null));
  });
}
