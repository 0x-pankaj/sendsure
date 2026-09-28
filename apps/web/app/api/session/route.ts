import { limitIp, respond } from "../../../lib/http";
import { signIn } from "../../../lib/session";

/** Sign in with a wallet signature; returns a 24-hour token. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "session", 30);
    return signIn(await req.json().catch(() => null));
  });
}
