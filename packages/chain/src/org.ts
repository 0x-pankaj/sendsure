import {
  encodeAbiParameters,
  erc20Abi,
  formatUnits,
  keccak256,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { deployment, mandateAbi } from "./generated";

/**
 * SendSure's agents. A new org authorises both: either may call settle(), neither can change the
 * rules, the caps or the payees. The Circle agent wallet (Circle CLI) is the primary one.
 */
export const SENDSURE_AGENTS = {
  circleAgentWallet: "0x9f977c4efff254a9284e69a0ae2b03e4ab851c07",
  serverAgent: "0xdE71581E008DD869241C550182A8B2FFa8063E30",
} as const satisfies Record<string, Address>;

/** Mirrors Mandate.TIER_PRODUCTION / TIER_SANDBOX. */
export const ORG_TIER = { PRODUCTION: 1, SANDBOX: 2 } as const;

export const USDC_DECIMALS = 6;
export const usdc = (amount: string | number): bigint => parseUnits(String(amount), USDC_DECIMALS);
export const formatUsdc = (units: bigint): string => formatUnits(units, USDC_DECIMALS);

export interface CapsInput {
  /** Most the org can pay in one period, all payees together. */
  orgPeriodCap: bigint;
  /** Most one payee can receive in one period. */
  payeePeriodCap: bigint;
  /** Largest single claim. */
  claimMax: bigint;
  /** Claims above this need a human co-sign. */
  coSignThreshold: bigint;
}

export interface NewOrgInput {
  owner: Address;
  treasury: Address;
  approvers: readonly Address[];
  caps: CapsInput;
  periodLength: bigint;
  firstBindCooldown: bigint;
  changeCooldown: bigint;
  tier?: number;
}

/** Test-sized defaults for a new org on Arc testnet (the faucet gives 10 USDC at a time). */
export const DEFAULT_CAPS: CapsInput = {
  orgPeriodCap: usdc(100),
  payeePeriodCap: usdc(50),
  claimMax: usdc(50),
  coSignThreshold: usdc(25),
};
export const DEFAULT_PERIOD_SECONDS = 30n * 86_400n;
export const DEFAULT_CHANGE_COOLDOWN_SECONDS = 86_400n;

/** The argument of MandateFactory.createMandate for an org that pays in USDC. */
export function initParams(input: NewOrgInput) {
  return {
    owner: input.owner,
    treasury: input.treasury,
    agents: [SENDSURE_AGENTS.circleAgentWallet, SENDSURE_AGENTS.serverAgent] as Address[],
    approvers: [...input.approvers],
    tokens: [deployment.usdc as Address],
    caps: [input.caps],
    periodLength: input.periodLength,
    firstBindCooldown: input.firstBindCooldown,
    changeCooldown: input.changeCooldown,
    tier: input.tier ?? ORG_TIER.PRODUCTION,
  };
}

export interface MandateView {
  org: Address;
  owner: Address;
  treasury: Address;
  tier: number;
  periodLength: bigint;
  caps: CapsInput;
  /** What the treasury let this org spend (USDC allowance), and what the treasury holds. */
  allowance: bigint;
  treasuryBalance: bigint;
  circleAgentAllowed: boolean;
}

type Reader = Pick<PublicClient, "readContract">;

export async function readMandate(client: Reader, org: Address): Promise<MandateView> {
  const token = deployment.usdc as Address;
  const m = { address: org, abi: mandateAbi } as const;
  const [owner, treasury, tier, periodLength, caps, circleAgentAllowed] = await Promise.all([
    client.readContract({ ...m, functionName: "owner" }),
    client.readContract({ ...m, functionName: "treasury" }),
    client.readContract({ ...m, functionName: "tier" }),
    client.readContract({ ...m, functionName: "periodLength" }),
    client.readContract({ ...m, functionName: "caps", args: [token] }),
    client.readContract({ ...m, functionName: "isAgent", args: [SENDSURE_AGENTS.circleAgentWallet] }),
  ]);
  const [allowance, treasuryBalance] = await Promise.all([
    client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [treasury, org] }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }),
  ]);
  const [orgPeriodCap, payeePeriodCap, claimMax, coSignThreshold] = caps;
  return {
    org,
    owner,
    treasury,
    tier,
    periodLength,
    caps: { orgPeriodCap, payeePeriodCap, claimMax, coSignThreshold },
    allowance,
    treasuryBalance,
    circleAgentAllowed,
  };
}

// ------------------------------------------------------------------ gasless onboarding messages
// The server checks these signatures before it relays anything for a payer. They are plain text
// on purpose: the wallet shows exactly what the payer agrees to.

export interface OrgRules {
  owner: Address;
  approvers: readonly Address[];
  caps: CapsInput;
  periodLength: bigint;
  changeCooldown: bigint;
  /** A test org (tier SANDBOX): never counted as a real payer. */
  sandbox: boolean;
}

const days = (seconds: bigint) => Number(seconds) / 86_400;

export function createOrgMessage(rules: OrgRules, validUntil: bigint): string {
  const c = rules.caps;
  return [
    rules.sandbox
      ? "SendSure: create a TEST payer org (sandbox) on Arc testnet."
      : "SendSure: create my payer org on Arc testnet.",
    `Owner and treasury: ${rules.owner}`,
    `Approvers (co-sign payments): ${rules.approvers.join(", ")}`,
    `Budget per ${days(rules.periodLength)} days: ${formatUsdc(c.orgPeriodCap)} USDC in total, ${formatUsdc(c.payeePeriodCap)} per payee, ${formatUsdc(c.claimMax)} per claim.`,
    `A person co-signs every payment above ${formatUsdc(c.coSignThreshold)} USDC and every first payment to a new address.`,
    `A payee's change of address waits ${days(rules.changeCooldown)} day(s).`,
    `SendSure agents that may pay inside these rules: ${SENDSURE_AGENTS.circleAgentWallet}, ${SENDSURE_AGENTS.serverAgent}.`,
    `Valid until: ${new Date(Number(validUntil) * 1000).toISOString()}`,
  ].join("\n");
}

export function openInvitesMessage(org: Address, batchHash: Hex, count: number, validUntil: bigint): string {
  return [
    `SendSure: open ${count} payee invite(s) for my org ${org}.`,
    `Invite batch: ${batchHash}`,
    `Valid until: ${new Date(Number(validUntil) * 1000).toISOString()}`,
  ].join("\n");
}

/** Binds an invites signature to exactly these payeeRefs. */
export const inviteBatchHash = (payeeRefs: readonly Hex[]): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [payeeRefs]));

// ------------------------------------------------------------------ USDC permit (EIP-2612)

/** Arc testnet USDC's EIP-712 domain (name "USDC", version "2"); checked against DOMAIN_SEPARATOR in tests. */
export const usdcDomain = {
  name: "USDC",
  version: "2",
  chainId: 5042002,
  verifyingContract: deployment.usdc as Address,
} as const;

export const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface PermitMessage {
  owner: Address;
  spender: Address;
  value: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** What the treasury signs to give its org a capped USDC allowance without paying gas. */
export const permitTypedData = (message: PermitMessage) =>
  ({ domain: usdcDomain, types: permitTypes, primaryType: "Permit", message }) as const;

export const usdcPermitAbi = [
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;
