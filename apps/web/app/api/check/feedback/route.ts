import { limitIp, respond } from "../../../../lib/http";
import { reviewFeedback } from "../../../../lib/review";

export const dynamic = "force-dynamic";

/** { agree, disagree }: how many of the agent's lines the person agreed with. Anonymous counts only. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "payout-review-feedback", 20, 60 * 60_000);
    return reviewFeedback(await req.json().catch(() => null));
  });
}
