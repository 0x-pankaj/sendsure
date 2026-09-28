import { limitIp, respond } from "../../../lib/http";
import { RelayError } from "../../../lib/relayer";
import { receiptFor } from "../../../lib/receipt";

export const dynamic = "force-dynamic";

/** ?tx=0x… A public receipt for one SendSure payment, from on-chain facts. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "receipt", 60);
    const tx = new URL(req.url).searchParams.get("tx") ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new RelayError(400, "tx must be a transaction hash.", "BAD_INPUT");
    return receiptFor(tx as `0x${string}`);
  });
}
