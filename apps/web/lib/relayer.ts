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
  deployment,
  payeeRegistryAbi,
  type BindMessage,
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
function relayer() {
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
  perIp: { max: 6, windowMs: 10 * 60_000 },
  perPayout: { max: 3, windowMs: 60 * 60_000 },
  global: { max: 500, windowMs: 24 * 60 * 60_000 },
} as const;

// ------------------------------------------------------------------ input checks

const isBytes32 = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const isSignature = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]{130}$/.test(v);

function toUint(v: unknown, bits: number, field: string): bigint {
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

function toAddress(v: unknown, field: string): Address {
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
export function parseBind(body: unknown, nowSec = Math.floor(Date.now() / 1000)): BindRequest {
  if (typeof body !== "object" || body === null) throw new RelayError(400, "Send a JSON object.", "BAD_INPUT");
  const b = body as Record<string, unknown>;
  if (!isBytes32(b.payeeRef)) throw new RelayError(400, "payeeRef must be 32 bytes of hex.", "BAD_INPUT");
  if (!isSignature(b.signature)) throw new RelayError(400, "signature must be 65 bytes of hex.", "BAD_INPUT");
  const validUntil = toUint(b.validUntil, 64, "validUntil");
  if (validUntil <= BigInt(nowSec)) throw new RelayError(400, REGISTRY_ERROR_TEXT.Expired!, "Expired");
  if (validUntil > BigInt(nowSec + MAX_SIGNATURE_TTL_SECONDS)) {
    throw new RelayError(400, "validUntil is too far ahead (at most 24 hours).", "BAD_INPUT");
  }
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

/** Turns a contract revert into the payee-facing text; anything else is an RPC problem. */
export function toRelayError(err: unknown): RelayError {
  if (err instanceof RelayError) return err;
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? "";
      let text = REGISTRY_ERROR_TEXT[name] ?? `The registry refused it (${name || "unknown reason"}).`;
      if (name === "BadState") {
        const state = PAYEE_STATES[Number(revert.data?.args?.[0] ?? 0)] ?? "unknown";
        text = state === "BOUND" ? "This invite was already used." : `This invite is not open (it is ${state}).`;
      }
      return new RelayError(409, text, name || "REVERTED");
    }
  }
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
}

async function sendAndWait(send: () => Promise<Hex>): Promise<RelayResult> {
  const txHash = await serial(send);
  try {
    const receipt = await serverClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });
    return { txHash, status: receipt.status };
  } catch {
    return { txHash, status: "pending" };
  }
}

/**
 * Relays a payee's signed Bind. The signature is checked here first (no RPC), then the call is
 * simulated, so the relayer never pays gas for a transaction the registry would reject.
 */
export async function relayBind(req: BindRequest): Promise<RelayResult> {
  const { message: m, signature } = req;
  const signer = await recoverTypedDataAddress({ ...bindTypedData(m), signature }).catch(() => null);
  if (!signer || signer !== m.payout) throw new RelayError(400, REGISTRY_ERROR_TEXT.BadSignature!, "BadSignature");

  const wallet = relayer();
  try {
    const { request } = await serverClient.simulateContract({
      account: wallet.account,
      address: registry,
      abi: payeeRegistryAbi,
      functionName: "bindWithSig",
      args: [m.org, m.payeeRef, m.payout, m.realAccountCommit, m.realProofType, m.nonce, m.validUntil, signature],
    });
    return await sendAndWait(() => wallet.writeContract(request));
  } catch (err) {
    throw toRelayError(err);
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
