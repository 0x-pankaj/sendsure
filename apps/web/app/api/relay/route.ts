import { relayerStatus } from "../../../lib/relayer";
import { NETWORK_NAME } from "@sendsure/chain";

export const dynamic = "force-dynamic";

/** Which address pays the gas for payee signatures, and how much USDC it has left. */
export async function GET() {
  try {
    return Response.json(await relayerStatus());
  } catch (err) {
    console.error(`relay status: cannot reach ${NETWORK_NAME}`, err);
    return Response.json({ configured: true, error: `Could not reach ${NETWORK_NAME}.` }, { status: 502 });
  }
}
