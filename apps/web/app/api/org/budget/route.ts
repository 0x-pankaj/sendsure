import { PERMIT } from "../../../../lib/orgRelay";
import { relayRoute } from "../../../../lib/relayer";

/** Give an org its capped USDC allowance from the treasury's signed permit (no gas for the payer). */
export function POST(req: Request) {
  return relayRoute(req, PERMIT);
}
