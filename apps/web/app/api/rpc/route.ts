import { limitIp } from "../../../lib/http";
import { RelayError } from "../../../lib/relayer";
import { arcRpcUrls } from "../../../lib/rpc";
import { NETWORK_NAME, arc } from "@sendsure/chain";

export const dynamic = "force-dynamic";

// Reads, and signed test-wallet co-signs: the browser's view of Arc goes through our RPC, so the pages keep working when Arc's public RPC is down.
const ALLOWED = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
]);

/** Arc testnet JSON-RPC for the browser: reads, and already-signed transactions. */
export async function POST(req: Request) {
  try {
    limitIp(req, "rpc", 1200);
    const body = (await req.json().catch(() => null)) as unknown;
    const calls = Array.isArray(body) ? body : [body];
    if (calls.length < 1 || calls.length > 20 || !calls.every((c) => ALLOWED.has((c as { method?: string } | null)?.method ?? ""))) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not allowed." } }, { status: 400 });
    }
    // The server's RPCs in order (ARC_RPC_URL, comma-separated), else this build's chain: the next one when
    // one is down, overloaded or rate-limiting. An answer, even a JSON-RPC error, is passed back as it is.
    const urls = arcRpcUrls();
    let last: Response | null = null;
    for (const url of urls.length ? urls : arc.rpcUrls.default.http) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(
        () => null,
      );
      if (res && res.status < 500 && res.status !== 429) {
        return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
      }
      last = res;
    }
    throw new Error(`every Arc RPC failed (last status ${last?.status ?? "none"})`);
  } catch (err) {
    const status = err instanceof RelayError ? err.status : 502;
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `${NETWORK_NAME} is not reachable.` } }, { status });
  }
}
