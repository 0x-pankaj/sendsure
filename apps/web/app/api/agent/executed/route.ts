import type { Hex } from "viem";
import { recordExecution } from "../../../../lib/agent";
import { isAgentOf, isOwnerOrApprover } from "../../../../lib/claims";
import { limitIp, respond } from "../../../../lib/http";
import { RelayError, toAddress, toObject, toUint } from "../../../../lib/relayer";
import { requireSession } from "../../../../lib/session";

/** { org, seq, txHash }: record a settle() the Circle agent wallet sent, after checking it on-chain. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "agent-executed", 60);
    const who = await requireSession(req);
    const b = toObject(await req.json().catch(() => null));
    const org = toAddress(b.org, "org");
    if (!(await isAgentOf(org, who)) && !(await isOwnerOrApprover(org, who)))
      throw new RelayError(403, "Not allowed for this org.", "FORBIDDEN");
    if (typeof b.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash))
      throw new RelayError(400, "txHash is required.", "BAD_INPUT");
    try {
      return await recordExecution(org, Number(toUint(b.seq, 32, "seq")), b.txHash as Hex);
    } catch (err) {
      throw new RelayError(400, String(err instanceof Error ? err.message : err), "NOT_RECORDED");
    }
  });
}
