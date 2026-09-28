// Server only. JSON responses with the same error shape everywhere: { error, code } + HTTP status.
import { RelayError, allow, clientIp } from "./relayer";

export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (err) {
    if (err instanceof RelayError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    console.error("api error", err);
    return Response.json({ error: "Something went wrong. Please try again.", code: "INTERNAL" }, { status: 500 });
  }
}

export function limitIp(req: Request, name: string, max: number, windowMs = 10 * 60_000): void {
  if (!allow(`${name}:ip:${clientIp(req)}`, max, windowMs)) {
    throw new RelayError(429, "Too many requests from this network. Please wait a few minutes.", "RATE_LIMITED");
  }
}
