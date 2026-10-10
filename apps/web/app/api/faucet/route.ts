import { limitIp, respond } from "../../../lib/http";
import { drip, faucetStatus } from "../../../lib/faucet";
import { clientIp } from "../../../lib/relayer";
import { requireSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

/** The signed-in wallet's balance and whether it can ask the faucet. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "faucet-status", 60);
    return faucetStatus(await requireSession(req));
  });
}

/** One drip of test USDC to the signed-in wallet (testnet only, once per wallet). */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "faucet", 5, 60 * 60_000);
    return drip(await requireSession(req), clientIp(req));
  });
}
