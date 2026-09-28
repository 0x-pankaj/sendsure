import { INVITES } from "../../../../lib/orgRelay";
import { relayRoute } from "../../../../lib/relayer";

/** Open payee invites signed by the org owner; SendSure's server agent submits openSlots. */
export function POST(req: Request) {
  return relayRoute(req, INVITES);
}
