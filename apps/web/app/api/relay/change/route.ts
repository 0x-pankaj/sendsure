import { CHANGE, relayRoute } from "../../../../lib/relayer";

/** POST a payout change signed by the current and the new address; submits PayeeRegistry.requestChange. */
export function POST(req: Request) {
  return relayRoute(req, CHANGE);
}
