// Server only. JSON responses with the same error shape everywhere: { error, code } + HTTP status.
// Each one names the chain, so a books system knows on every call whether it moves test or real USDC.
import { arc } from "@sendsure/chain";
import { RelayError, allow, clientIp } from "./relayer";

const CHAIN_HEADER = { "x-sendsure-chain": String(arc.id) };

export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn(), { headers: CHAIN_HEADER });
  } catch (err) {
    if (err instanceof RelayError)
      return Response.json({ error: err.message, code: err.code }, { status: err.status, headers: CHAIN_HEADER });
    console.error("api error", err);
    return Response.json({ error: "Something went wrong. Please try again.", code: "INTERNAL" }, { status: 500, headers: CHAIN_HEADER });
  }
}

export function limitIp(req: Request, name: string, max: number, windowMs = 10 * 60_000): void {
  if (!allow(`${name}:ip:${clientIp(req)}`, max, windowMs)) {
    throw new RelayError(429, "Too many requests from this network. Please wait a few minutes.", "RATE_LIMITED");
  }
}
