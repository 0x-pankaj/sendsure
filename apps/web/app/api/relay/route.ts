import { relayerStatus } from "../../../lib/relayer";

export const dynamic = "force-dynamic";

/** Which address pays the gas for payee signatures, and how much testnet USDC it has left. */
export async function GET() {
  try {
    return Response.json(await relayerStatus());
  } catch {
    return Response.json({ configured: true, error: "Could not reach Arc testnet." }, { status: 502 });
  }
}
