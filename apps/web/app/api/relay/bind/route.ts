import { LIMITS, RelayError, allow, clientIp, parseBind, relayBind } from "../../../../lib/relayer";

/** POST a payee's signed Bind; the relayer pays the gas and submits PayeeRegistry.bindWithSig. */
export async function POST(req: Request) {
  try {
    if (!allow("global", LIMITS.global.max, LIMITS.global.windowMs)) {
      throw new RelayError(429, "The relayer is busy today. Please try again tomorrow.", "RATE_LIMITED");
    }
    if (!allow(`ip:${clientIp(req)}`, LIMITS.perIp.max, LIMITS.perIp.windowMs)) {
      throw new RelayError(429, "Too many tries from this network. Please wait 10 minutes.", "RATE_LIMITED");
    }
    const body = await req.json().catch(() => null);
    const bind = parseBind(body);
    if (!allow(`payout:${bind.message.payout}`, LIMITS.perPayout.max, LIMITS.perPayout.windowMs)) {
      throw new RelayError(429, "Too many tries for this address. Please wait an hour.", "RATE_LIMITED");
    }
    return Response.json(await relayBind(bind));
  } catch (err) {
    if (err instanceof RelayError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    console.error("relay/bind failed", err);
    return Response.json({ error: "The relay failed. Please try again.", code: "INTERNAL" }, { status: 500 });
  }
}
