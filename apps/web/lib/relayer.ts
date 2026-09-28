// Server only: imported by route handlers under app/api. Never import this from a client component.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  nonceManager,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  MAX_SIGNATURE_TTL_SECONDS,
  PAYEE_STATES,
  REGISTRY_ERROR_TEXT,
  ZERO_BYTES32,
  arcTestnet,
  bindTypedData,
  changeTypedData,
  deployment,
  payeeRegistryAbi,
  readPayee,
  type BindMessage,
  type ChangeMessage,
} from "@sendsure/chain";

/** An error the relayer returns to the caller as { error, code } with an HTTP status. */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "RELAY_ERROR",
  ) {
    super(message);
  }
}

const registry = deployment.payeeRegistry as Address;
const transport = http(process.env.ARC_RPC_URL || undefined);
export const serverClient = createPublicClient({ chain: arcTestnet, transport });

let walletClient: ReturnType<typeof makeWallet> | undefined;
function makeWallet() {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new RelayError(503, "The relayer is not set up on this server.", "NOT_CONFIGURED");
  }
  // The relayer key only pays gas. It holds no role in any contract.
  const account = privateKeyToAccount(key as Hex, { nonceManager });
  return createWalletClient({ account, chain: arcTestnet, transport });
}
export function relayer() {
  walletClient ??= makeWallet();
  return walletClient;
}

// ------------------------------------------------------------------ rate limits (in memory, one instance)

const hits = new Map<string, number[]>();

/** Sliding-window limit. Resets when the server restarts, which is fine for a testnet relayer. */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 50_000) hits.clear();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const ok = recent.length < max;
  if (ok) recent.push(now);
  hits.set(key, recent);
  return ok;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export const LIMITS = {
  perIp: { max: 30, windowMs: 10 * 60_000 },
  perPayout: { max: 3, windowMs: 60 * 60_000 },
  global: { max: 500, windowMs: 24 * 60 * 60_000 },
} as const;

// ------------------------------------------------------------------ input checks

export const isBytes32 = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
export const isSignature = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{130}$/.test(v);

export function toUint(v: unknown, bits: number, field: string): bigint {
  if (typeof v !== "string" && typeof v !== "number") throw new RelayError(400, `${field} is missing.`, "BAD_INPUT");
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    throw new RelayError(400, `${field} is not a number.`, "BAD_INPUT");
  }
  if (n < 0n || n >= 2n ** BigInt(bits)) throw new RelayError(400, `${field} is out of range.`, "BAD_INPUT");
  return n;
}

export function toAddress(v: unknown, field: string): Address {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) {
    throw new RelayError(400, `${field} is not an address.`, "BAD_INPUT");
  }
  return getAddress(v);
}

export interface BindRequest {
  message: BindMessage;
  signature: Hex;
}

/** Validates a bind request body. Only plain binds are relayed (no real-account commitment yet). */
export function toObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) throw new RelayError(400, "Send a JSON object.", "BAD_INPUT");
  return body as Record<string, unknown>;
}

export function toValidUntil(v: unknown, nowSec: number): bigint {
  const validUntil = toUint(v, 64, "validUntil");
  if (validUntil <= BigInt(nowSec)) throw new RelayError(400, REGISTRY_ERROR_TEXT.Expired!, "Expired");
  if (validUntil > BigInt(nowSec + MAX_SIGNATURE_TTL_SECONDS)) {
    throw new RelayError(400, "validUntil is too far ahead (at most 24 hours).", "BAD_INPUT");
  }
  return validUntil;
}

export function parseBind(body: unknown, nowSec = Math.floor(Date.now() / 1000)): BindRequest {
  const b = toObject(body);
  if (!isBytes32(b.payeeRef)) throw new RelayError(400, "payeeRef must be 32 bytes of hex.", "BAD_INPUT");
  if (!isSignature(b.signature)) throw new RelayError(400, "signature must be 65 bytes of hex.", "BAD_INPUT");
  const validUntil = toValidUntil(b.validUntil, nowSec);
  return {
    message: {
      org: toAddress(b.org, "org"),
      payeeRef: b.payeeRef,
      payout: toAddress(b.payout, "payout"),
      realAccountCommit: ZERO_BYTES32,
      realProofType: 0,
      nonce: toUint(b.nonce, 256, "nonce"),
      validUntil,
    },
    signature: b.signature,
  };
}

export interface ChangeRequest {
  message: ChangeMessage;
  oldSig: Hex;
  newSig: Hex;
}

/** Validates a change request: both the old and the new payout address must have signed. */
export function parseChange(body: unknown, nowSec = Math.floor(Date.now() / 1000)): ChangeRequest {
  const b = toObject(body);
  if (!isBytes32(b.payeeRef)) throw new RelayError(400, "payeeRef must be 32 bytes of hex.", "BAD_INPUT");
  if (!isSignature(b.oldSig)) throw new RelayError(400, "oldSig must be 65 bytes of hex.", "BAD_INPUT");
  if (!isSignature(b.newSig)) throw new RelayError(400, "newSig must be 65 bytes of hex.", "BAD_INPUT");
  const message: ChangeMessage = {
    org: toAddress(b.org, "org"),
    payeeRef: b.payeeRef,
    oldPayout: toAddress(b.oldPayout, "oldPayout"),
    newPayout: toAddress(b.newPayout, "newPayout"),
    nonce: toUint(b.nonce, 256, "nonce"),
    validUntil: toValidUntil(b.validUntil, nowSec),
  };
  if (message.oldPayout === message.newPayout) throw new RelayError(400, REGISTRY_ERROR_TEXT.SamePayout!, "SamePayout");
  return { message, oldSig: b.oldSig, newSig: b.newSig };
}

const MANDATE_ERROR_TEXT: Record<string, string> = {
  BadInit: "Those org settings are not allowed.",
  RoleConflict: "An agent cannot also be the owner, the treasury or an approver.",
  NotOwnerOrAgent: "Only the org owner or a SendSure agent can open invites.",
  ZeroAddress: "An address is empty.",
};

/** Turns a contract revert into the payee-facing text; anything else is an RPC problem. */
export function toRelayError(err: unknown): RelayError {
  if (err instanceof RelayError) return err;
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      let text =
        REGISTRY_ERROR_TEXT[name] ?? MANDATE_ERROR_TEXT[name] ?? `The chain refused it (${name || revert.reason || "unknown reason"}).`;
      if (name === "BadState") {
        const state = PAYEE_STATES[Number(revert.data?.args?.[0] ?? 0)] ?? "unknown";
        text = state === "BOUND" ? "This invite was already used." : `This invite is not open (it is ${state}).`;
      }
      return new RelayError(409, text, name || "REVERTED");
    }
  }
  console.error("relayer: RPC error", err instanceof BaseError ? err.shortMessage : err, err instanceof BaseError ? err.details : "");
  return new RelayError(502, "Could not reach Arc testnet. Please try again in a minute.", "RPC_ERROR");
}

// ------------------------------------------------------------------ sending

let queue: Promise<unknown> = Promise.resolve();
/** One transaction at a time, so relayed transactions never race for the same nonce. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export interface RelayResult {
  txHash: Hex;
  status: "success" | "reverted" | "pending";
  /** Set when the transaction created an org. */
  org?: Address;
}

const isNonceError = (err: unknown) =>
  /nonce too low|nonce has already been used|already known|replacement transaction underpriced/i.test(String(err));

/**
 * Sends one transaction and waits for it. On Cloudflare several isolates can send at once, so a nonce
 * clash is possible: then the account's nonce is re-read and the send retried (3 tries in all).
 */
export async function sendAndWait(send: () => Promise<Hex>, from?: Address): Promise<RelayResult> {
  let txHash: Hex | undefined;
  for (let attempt = 1; !txHash; attempt++) {
    try {
      txHash = await serial(send);
    } catch (err) {
      if (!from || attempt >= 3 || !isNonceError(err)) throw err;
      nonceManager.reset({ address: from, chainId: arcTestnet.id });
    }
  }
  try {
    const receipt = await serverClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    return { txHash, status: receipt.status };
  } catch {
    return { txHash, status: "pending" };
  }
}

/** Offline check (no RPC): the payout address itself signed this Bind. */
export async function verifyBind(req: BindRequest): Promise<void> {
  const { message: m, signature } = req;
  const signer = await recoverTypedDataAddress({ ...bindTypedData(m), signature }).catch(() => null);
  if (!signer || signer !== m.payout) throw new RelayError(400, REGISTRY_ERROR_TEXT.BadSignature!, "BadSignature");
}

/**
 * Submits a verified Bind. The call is simulated first, so the relayer never pays gas for a
 * transaction the registry would reject.
 */
export async function submitBind(req: BindRequest): Promise<RelayResult> {
  const { message: m, signature } = req;
  const wallet = relayer();
  try {
    const { request } = await serverClient.simulateContract({
      account: wallet.account,
      address: registry,
      abi: payeeRegistryAbi,
      functionName: "bindWithSig",
      args: [m.org, m.payeeRef, m.payout, m.realAccountCommit, m.realProofType, m.nonce, m.validUntil, signature],
    });
    return await sendAndWait(() => wallet.writeContract(request), wallet.account.address);
  } catch (err) {
    throw toRelayError(err);
  }
}

/** Offline check (no RPC): BOTH the current payout and the new one signed this change. */
export async function verifyChange(req: ChangeRequest): Promise<void> {
  const { message: m, oldSig, newSig } = req;
  const typed = changeTypedData(m);
  const [oldSigner, newSigner] = await Promise.all([
    recoverTypedDataAddress({ ...typed, signature: oldSig }).catch(() => null),
    recoverTypedDataAddress({ ...typed, signature: newSig }).catch(() => null),
  ]);
  if (oldSigner !== m.oldPayout) {
    throw new RelayError(400, "The current payout address did not sign this change.", "BadSignature");
  }
  if (newSigner !== m.newPayout) throw new RelayError(400, "The new payout address did not sign this change.", "BadSignature");
}

/**
 * Submits a verified change. The registry holds it for the org's change cooldown; until then
 * payments still go to the current address, and the payer or the current payout can cancel it.
 */
export async function submitChange(req: ChangeRequest): Promise<RelayResult> {
  const { message: m, oldSig, newSig } = req;
  const wallet = relayer();
  try {
    const current = await readPayee(serverClient, m.org, m.payeeRef);
    if (current.payout !== m.oldPayout) {
      throw new RelayError(409, `The current payout address is ${current.payout}, not ${m.oldPayout}.`, "NotPayout");
    }
    const { request } = await serverClient.simulateContract({
      account: wallet.account,
      address: registry,
      abi: payeeRegistryAbi,
      functionName: "requestChange",
      args: [m.org, m.payeeRef, m.newPayout, m.nonce, m.validUntil, oldSig, newSig],
    });
    return await sendAndWait(() => wallet.writeContract(request), wallet.account.address);
  } catch (err) {
    throw toRelayError(err);
  }
}

export async function relayBind(req: BindRequest): Promise<RelayResult> {
  await verifyBind(req);
  return submitBind(req);
}

export async function relayChange(req: ChangeRequest): Promise<RelayResult> {
  await verifyChange(req);
  return submitChange(req);
}

export interface RelayKind<T> {
  /** Names the per-endpoint daily cap, which bounds what the relayer can spend on gas. */
  name: string;
  perDay: number;
  parse: (body: unknown) => T;
  /** Offline signature check. Runs before the per-address limit, so nobody can use up another address's quota. */
  verify: (parsed: T) => Promise<void>;
  payoutOf: (parsed: T) => string;
  submit: (parsed: T) => Promise<RelayResult>;
  /** Limit per signer / org key; defaults to LIMITS.perPayout. */
  perKey?: { max: number; windowMs: number };
}

export const BIND: RelayKind<BindRequest> = {
  name: "bind",
  perDay: 200,
  parse: (body) => parseBind(body),
  verify: verifyBind,
  payoutOf: (b) => b.message.payout,
  submit: submitBind,
};

export const CHANGE: RelayKind<ChangeRequest> = {
  name: "change",
  perDay: 100,
  parse: (body) => parseChange(body),
  verify: verifyChange,
  payoutOf: (c) => c.message.oldPayout,
  submit: submitChange,
};

/** One handler for every relay route: global and per-IP limits, parse, verify, per-address limit, submit. */
export async function relayRoute<T>(req: Request, kind: RelayKind<T>): Promise<Response> {
  try {
    if (
      !allow("global", LIMITS.global.max, LIMITS.global.windowMs) ||
      !allow(`day:${kind.name}`, kind.perDay, LIMITS.global.windowMs)
    ) {
      throw new RelayError(429, "The relayer is busy today. Please try again tomorrow.", "RATE_LIMITED");
    }
    if (!allow(`ip:${clientIp(req)}`, LIMITS.perIp.max, LIMITS.perIp.windowMs)) {
      throw new RelayError(429, "Too many tries from this network. Please wait 10 minutes.", "RATE_LIMITED");
    }
    const parsed = kind.parse(await req.json().catch(() => null));
    await kind.verify(parsed);
    const perKey = kind.perKey ?? LIMITS.perPayout;
    if (!allow(`payout:${kind.payoutOf(parsed)}`, perKey.max, perKey.windowMs)) {
      throw new RelayError(429, "Too many tries for this address. Please wait an hour.", "RATE_LIMITED");
    }
    return Response.json(await kind.submit(parsed));
  } catch (err) {
    if (err instanceof RelayError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    console.error("relay failed", err);
    return Response.json({ error: "The relay failed. Please try again.", code: "INTERNAL" }, { status: 500 });
  }
}

/** For the status page: which address pays the gas and how much it has left. */
export async function relayerStatus(): Promise<{ configured: boolean; address?: Address; balanceUsdc?: string }> {
  try {
    const { account } = relayer();
    const wei = await serverClient.getBalance({ address: account.address });
    return { configured: true, address: account.address, balanceUsdc: formatEther(wei) };
  } catch (err) {
    if (err instanceof RelayError && err.code === "NOT_CONFIGURED") return { configured: false };
    throw err;
  }
}
