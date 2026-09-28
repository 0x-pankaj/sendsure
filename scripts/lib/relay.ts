import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  SIGNATURE_TTL_SECONDS,
  ZERO_BYTES32,
  bindTypedData,
  randomBytes32,
  randomNonce,
  type BindMessage,
} from "@sendsure/chain";
import { openInvite } from "../invite";

export interface RelayResponse {
  status: number;
  body: { txHash?: Hex; status?: string; error?: string; code?: string };
}

/** POST to the relayer the same way the verify page does (bigints as decimal strings). */
export async function postRelay(base: string, path: "bind" | "change", payload: Record<string, unknown>): Promise<RelayResponse> {
  const body = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const res = await fetch(`${base}/api/relay/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
  return { status: res.status, body: (await res.json()) as RelayResponse["body"] };
}

export const soon = () => BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS);

export function bindMessage(org: Hex, payeeRef: Hex, payout: Hex): BindMessage {
  return { org, payeeRef, payout, realAccountCommit: ZERO_BYTES32, realProofType: 0, nonce: randomNonce(), validUntil: soon() };
}

/** Opens an invite as the org owner and binds a brand-new EOA to it through the relayer. */
export async function bindFreshPayee(base: string, org: Hex, ownerKey: Hex) {
  const payeeRef = randomBytes32();
  const openTx = await openInvite({ org, payeeRef, ownerKey });
  const account: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey());
  const message = bindMessage(org, payeeRef, account.address);
  const bind = await postRelay(base, "bind", { ...message, signature: await account.signTypedData(bindTypedData(message)) });
  if (bind.status !== 200 || bind.body.status !== "success") throw new Error(`bind failed: ${JSON.stringify(bind.body)}`);
  return { payeeRef, account, openTx, bindTx: bind.body.txHash! };
}

let failures = 0;
export function check(ok: boolean, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
}
export const failed = () => failures;

// ------------------------------------------------------------------ app API helpers (sessions, orgs)

export async function api(base: string, path: string, init: { body?: unknown; token?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** Sign in like the web app does; returns the session token. */
export async function signInAs(base: string, account: PrivateKeyAccount): Promise<string> {
  const { signInMessage } = await import("../../apps/web/lib/signin");
  const issuedAt = new Date().toISOString();
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const signature = await account.signMessage({ message: signInMessage(account.address, issuedAt, nonce) });
  const r = await api(base, "/api/session", { body: { address: account.address, issuedAt, nonce, signature } });
  if (r.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}
