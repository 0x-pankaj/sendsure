import { BIND, relayRoute } from "../../../../lib/relayer";

/** POST a payee's signed Bind; the relayer pays the gas and submits PayeeRegistry.bindWithSig. */
export function POST(req: Request) {
  return relayRoute(req, BIND);
}
