import { handleMcp } from "../../../lib/mcp";
import { RelayError, allow, clientIp } from "../../../lib/relayer";

export const dynamic = "force-dynamic";

/** MCP over Streamable HTTP (stateless, JSON responses). Accepts one message or a batch. */
export async function POST(req: Request) {
  if (!allow(`mcp:ip:${clientIp(req)}`, 120, 10 * 60_000)) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests; wait a few minutes." } },
      { status: 429 },
    );
  }
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object") {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  try {
    const messages = Array.isArray(body) ? body : [body];
    const replies = (await Promise.all(messages.map((m) => handleMcp(m as Record<string, unknown>)))).filter(Boolean);
    if (!replies.length) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? replies : replies[0]);
  } catch (err) {
    const message = err instanceof RelayError ? err.message : "Internal error";
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message } }, { status: 500 });
  }
}

/** No server-initiated stream: this server only answers requests. */
export function GET() {
  return new Response("SendSure MCP: POST JSON-RPC here (Streamable HTTP, no SSE stream).", {
    status: 405,
    headers: { allow: "POST" },
  });
}
