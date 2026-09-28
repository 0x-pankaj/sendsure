// Server only. Sign-in with a wallet signature; the server returns a short HMAC token.
// WebCrypto only, so it runs the same on Node and on Cloudflare Workers.
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { RelayError, serverClient } from "./relayer";
import { signInMessage } from "./signin";

export { signInMessage };

export const SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new RelayError(503, "Sign-in is not set up on this server.", "NOT_CONFIGURED");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}

export async function issueToken(address: Address, nowMs = Date.now()): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ a: address, e: expiresAt })));
  return { token: `${payload}.${await hmac(payload)}`, expiresAt };
}

export async function readToken(token: string, nowMs = Date.now()): Promise<Address | null> {
  const [payload, mac] = token.split(".");
  if (!payload || !mac || mac !== (await hmac(payload))) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a: string; e: number };
    return isAddress(a) && e * 1000 > nowMs ? getAddress(a) : null;
  } catch {
    return null;
  }
}

/** POST /api/session body: { address, issuedAt, nonce, signature }. */
export async function signIn(body: unknown, nowMs = Date.now()) {
  const b = (typeof body === "object" && body ? body : {}) as Record<string, unknown>;
  if (typeof b.address !== "string" || !isAddress(b.address, { strict: false }))
    throw new RelayError(400, "address is missing.", "BAD_INPUT");
  if (typeof b.issuedAt !== "string" || typeof b.nonce !== "string" || !/^[0-9a-f]{16,64}$/.test(b.nonce)) {
    throw new RelayError(400, "issuedAt and nonce are required.", "BAD_INPUT");
  }
  const issued = Date.parse(b.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(nowMs - issued) > MAX_CLOCK_SKEW_MS) {
    throw new RelayError(400, "The sign-in message is too old. Please try again.", "Expired");
  }
  const address = getAddress(b.address);
  const message = signInMessage(address, b.issuedAt, b.nonce);
  const signature = b.signature as Hex;
  // Plain wallets are checked offline; smart accounts (e.g. the Circle agent wallet) on-chain (ERC-1271).
  const ok =
    (await verifyMessage({ address, message, signature }).catch(() => false)) ||
    (await serverClient.verifyMessage({ address, message, signature }).catch(() => false));
  if (!ok) throw new RelayError(400, "The signature does not match the address.", "BadSignature");
  return { address, ...(await issueToken(address, nowMs)) };
}

/** The signed-in address from `Authorization: Bearer <token>`, or a 401. */
export async function requireSession(req: Request): Promise<Address> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const address = token ? await readToken(token) : null;
  if (!address) throw new RelayError(401, "Please sign in again.", "UNAUTHENTICATED");
  return address;
}
