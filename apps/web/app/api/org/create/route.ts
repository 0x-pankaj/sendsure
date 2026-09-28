import { CREATE_ORG } from "../../../../lib/orgRelay";
import { relayRoute } from "../../../../lib/relayer";

/** Create a payer org from the owner's signed settings (the relayer pays the gas). */
export function POST(req: Request) {
  return relayRoute(req, CREATE_ORG);
}
