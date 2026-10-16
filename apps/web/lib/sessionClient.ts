import { getAddress, type Address } from "viem";
import { signInMessage } from "./signin";
import { signText, type Signer } from "./wallet";

const storageKey = (a: Address) => `sendsure.session.${a.toLowerCase()}`;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Sign-ins in progress, one per wallet. A page that loads two lists at once must ask for one signature, not two: a
// passkey allows only one prompt at a time, so the second would fail (and the payee would not see their invoices).
const pending = new Map<string, Promise<string>>();

/** A session token for this wallet: reused for a day, otherwise one sign-in signature. */
export async function sessionToken(s: Signer, fresh = false): Promise<string> {
  if (!fresh) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(s.address)) ?? "null") as {
        token: string;
        expiresAt: number;
      } | null;
      if (saved && saved.expiresAt * 1000 > Date.now() + 60_000) return saved.token;
    } catch {
      // No storage: sign in again.
    }
  }
  const key = s.address.toLowerCase();
  const running = pending.get(key);
  if (running) return running;
  const signingIn = signIn(s).finally(() => pending.delete(key));
  pending.set(key, signingIn);
  return signingIn;
}

async function signIn(s: Signer): Promise<string> {
  const issuedAt = new Date().toISOString();
  const nonce = randomHex(16);
  // The server rebuilds the message with the checksummed address, so sign exactly that text.
  const signature = await signText(s, signInMessage(getAddress(s.address), issuedAt, nonce));
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: s.address, issuedAt, nonce, signature }),
  });
  const out = (await res.json().catch(() => ({}))) as { token?: string; expiresAt?: number; error?: string };
  if (!res.ok || !out.token) throw new Error(out.error ?? `Sign-in failed (${res.status}).`);
  try {
    sessionStorage.setItem(storageKey(s.address), JSON.stringify({ token: out.token, expiresAt: out.expiresAt }));
  } catch {
    // Private mode: the token lives for this call only.
  }
  return out.token;
}

/** fetch() with the session token; signs in again once if the server says the token is stale. */
export async function authedFetch(s: Signer, url: string, init: RequestInit = {}): Promise<Response> {
  const call = async (fresh: boolean) =>
    fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${await sessionToken(s, fresh)}` } });
  const res = await call(false);
  return res.status === 401 ? call(true) : res;
}

export async function jsonOrThrow<T>(res: Response): Promise<T> {
  const out = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
  return out;
}
