import type { Address, Hex, PublicClient } from "viem";
import { deployment, payeeRegistryAbi } from "./generated";
import { bindTypes, changeTypes, registryDomain } from "./typed";

/** Mirrors PayeeRegistry.State and PayeeRegistry.Tier (same order as the Solidity enums). */
export const PAYEE_STATES = ["NONE", "OPEN", "BOUND", "FROZEN", "REVOKED"] as const;
export const PAYEE_TIERS = ["NONE", "PROVEN", "ATTESTED"] as const;
export type PayeeState = (typeof PAYEE_STATES)[number];
export type PayeeTier = (typeof PAYEE_TIERS)[number];

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

/** How long a payee's Bind or ChangePayout signature stays valid. The relayer refuses longer ones. */
export const SIGNATURE_TTL_SECONDS = 30 * 60;
export const MAX_SIGNATURE_TTL_SECONDS = 24 * 60 * 60;

export interface BindMessage {
  org: Address;
  payeeRef: Hex;
  payout: Address;
  realAccountCommit: Hex;
  realProofType: number;
  nonce: bigint;
  validUntil: bigint;
}

export interface ChangeMessage {
  org: Address;
  payeeRef: Hex;
  oldPayout: Address;
  newPayout: Address;
  nonce: bigint;
  validUntil: bigint;
}

/** What a payee signs (eth_signTypedData_v4) to bind an invite slot to their own address. */
export const bindTypedData = (message: BindMessage) =>
  ({ domain: registryDomain, types: bindTypes, primaryType: "Bind", message }) as const;

/** What the old and the new payout address both sign to move a binding to the new address. */
export const changeTypedData = (message: ChangeMessage) =>
  ({ domain: registryDomain, types: changeTypes, primaryType: "ChangePayout", message }) as const;

/** A random 256-bit nonce. The registry only requires that a signer never reuses one. */
export function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
}

/** A random bytes32, e.g. a payeeRef for a one-off invite. */
export function randomBytes32(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface PayeeView {
  payout: Address;
  state: PayeeState;
  tier: PayeeTier;
  anchors: number;
  version: number;
  activeAt: bigint;
  changePending: boolean;
}

export interface OrgView {
  registered: boolean;
  firstBindCooldown: bigint;
  changeCooldown: bigint;
}

type Reader = Pick<PublicClient, "readContract">;
const registry = deployment.payeeRegistry as Address;

/** The binding as a Mandate sees it right now (a matured change is already applied). */
export async function readPayee(client: Reader, org: Address, payeeRef: Hex): Promise<PayeeView> {
  const p = await client.readContract({
    address: registry,
    abi: payeeRegistryAbi,
    functionName: "payeeOf",
    args: [org, payeeRef],
  });
  return {
    payout: p.payout,
    state: PAYEE_STATES[p.state] ?? "NONE",
    tier: PAYEE_TIERS[p.tier] ?? "NONE",
    anchors: p.anchors,
    version: p.version,
    activeAt: p.activeAt,
    changePending: p.changePending,
  };
}

export interface PendingChange {
  newPayout: Address;
  effectiveAt: bigint;
}

/** The change waiting for its cooldown, if any (null once it has matured or when there is none). */
export async function readPendingChange(
  client: Reader,
  org: Address,
  payeeRef: Hex,
  nowSec = BigInt(Math.floor(Date.now() / 1000)),
): Promise<PendingChange | null> {
  const b = await client.readContract({
    address: registry,
    abi: payeeRegistryAbi,
    functionName: "bindingOf",
    args: [org, payeeRef],
  });
  if (b.pendingPayout === "0x0000000000000000000000000000000000000000" || b.pendingAt <= nowSec) return null;
  return { newPayout: b.pendingPayout, effectiveAt: b.pendingAt };
}

export async function readOrg(client: Reader, org: Address): Promise<OrgView> {
  const [registered, firstBindCooldown, changeCooldown] = await client.readContract({
    address: registry,
    abi: payeeRegistryAbi,
    functionName: "orgs",
    args: [org],
  });
  return { registered, firstBindCooldown, changeCooldown };
}

/** Plain-English text for PayeeRegistry errors, for payees and for relayer responses. */
export const REGISTRY_ERROR_TEXT: Record<string, string> = {
  NotOrg: "This link does not point to a SendSure payer.",
  BadState: "This invite is not open.",
  ZeroAddress: "The address is empty.",
  Blocklisted: "This address is on the USDC issuer's blocklist, so it cannot be paid.",
  PayoutIsOrg: "The payout address cannot be the payer's own contract.",
  BadProofType: "That proof type is not supported.",
  Expired: "The signature expired. Please sign again.",
  NonceUsed: "This signature was already used. Please sign again.",
  BadSignature: "The signature does not match the address.",
  NotPayout: "Only the current payout address can do this.",
  SamePayout: "The new address is the same as the current one.",
  ChangeAlreadyPending: "A change is already waiting. Cancel it first, or wait until it takes effect.",
  NoPendingChange: "There is no pending change.",
  ChangeNotMature: "The waiting period has not ended yet.",
  AttestedCannotChange: "The payer added this address for you, so only the payer can replace it.",
};

/** "1 day", "3 hours", "20 minutes" */
export function formatDuration(seconds: bigint | number): string {
  const s = Number(seconds);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (s <= 0) return "no wait";
  if (s % 86_400 === 0) return unit(s / 86_400, "day");
  if (s >= 3_600) return unit(Math.round(s / 3_600), "hour");
  return unit(Math.max(1, Math.round(s / 60)), "minute");
}
