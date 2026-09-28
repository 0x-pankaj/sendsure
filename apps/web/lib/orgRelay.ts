// Server only. Gasless payer onboarding: the payer signs, SendSure submits and pays the gas.
//   create org  -> the relayer calls MandateFactory.createMandate (anyone may; the signature is the payer's consent)
//   budget      -> the relayer submits the treasury's USDC permit (EIP-2612)
//   invites     -> SendSure's server agent, an agent of the org, calls Mandate.openSlots
import {
  createWalletClient,
  http,
  nonceManager,
  parseEventLogs,
  parseSignature,
  recoverTypedDataAddress,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ORG_TIER,
  SENDSURE_AGENTS,
  arcTestnet,
  createOrgMessage,
  deployment,
  initParams,
  inviteBatchHash,
  mandateAbi,
  mandateFactoryAbi,
  openInvitesMessage,
  payeeRegistryAbi,
  permitTypedData,
  usdcPermitAbi,
  type CapsInput,
  type OrgRules,
  type PermitMessage,
} from "@sendsure/chain";
import {
  RelayError,
  isBytes32,
  isSignature,
  relayer,
  sendAndWait,
  serverClient,
  toAddress,
  toObject,
  toRelayError,
  toUint,
  toValidUntil,
  type RelayKind,
  type RelayResult,
} from "./relayer";

const factory = deployment.mandateFactory as Address;
const errorsOnly = <T extends readonly { type: string }[]>(abi: T) => abi.filter((x) => x.type === "error");
/** The factory ABI plus the errors its calls can bubble up, so reverts decode to names. */
const factoryAbiWithErrors = [...mandateFactoryAbi, ...errorsOnly(mandateAbi), ...errorsOnly(payeeRegistryAbi)];
const mandateAbiWithErrors = [...mandateAbi, ...errorsOnly(payeeRegistryAbi)];
const DAY = 86_400n;

// ------------------------------------------------------------------ create org

export interface CreateOrgRequest {
  rules: OrgRules;
  validUntil: bigint;
  signature: Hex;
}

function toCaps(v: unknown): CapsInput {
  const c = toObject(v);
  const caps = {
    orgPeriodCap: toUint(c.orgPeriodCap, 128, "orgPeriodCap"),
    payeePeriodCap: toUint(c.payeePeriodCap, 128, "payeePeriodCap"),
    claimMax: toUint(c.claimMax, 128, "claimMax"),
    coSignThreshold: toUint(c.coSignThreshold, 128, "coSignThreshold"),
  };
  if (caps.orgPeriodCap === 0n || caps.payeePeriodCap === 0n || caps.claimMax === 0n) {
    throw new RelayError(400, "Set a budget above zero.", "BAD_INPUT");
  }
  if (caps.payeePeriodCap > caps.orgPeriodCap || caps.claimMax > caps.payeePeriodCap || caps.coSignThreshold > caps.claimMax) {
    throw new RelayError(
      400,
      "Keep claim max ≤ per-payee budget ≤ total budget, and the co-sign amount ≤ claim max.",
      "BAD_INPUT",
    );
  }
  return caps;
}

export function parseCreateOrg(body: unknown, nowSec = Math.floor(Date.now() / 1000)): CreateOrgRequest {
  const b = toObject(body);
  if (!isSignature(b.signature)) throw new RelayError(400, "signature must be 65 bytes of hex.", "BAD_INPUT");
  const owner = toAddress(b.owner, "owner");
  const approvers = Array.isArray(b.approvers) ? b.approvers.map((a, i) => toAddress(a, `approvers[${i}]`)) : [];
  if (approvers.length < 1 || approvers.length > 3) throw new RelayError(400, "Name one to three approvers.", "BAD_INPUT");
  const agents = Object.values(SENDSURE_AGENTS).map((a) => a.toLowerCase());
  if ([owner, ...approvers].some((a) => agents.includes(a.toLowerCase()))) {
    throw new RelayError(400, "The owner and approvers must be your own addresses, not SendSure's agents.", "BAD_INPUT");
  }
  const periodLength = toUint(b.periodLength, 64, "periodLength");
  const changeCooldown = toUint(b.changeCooldown, 64, "changeCooldown");
  if (periodLength % DAY !== 0n || periodLength < DAY || periodLength > 365n * DAY) {
    throw new RelayError(400, "The budget period must be whole days (1 to 365).", "BAD_INPUT");
  }
  if (changeCooldown % DAY !== 0n || changeCooldown < DAY || changeCooldown > 30n * DAY) {
    throw new RelayError(400, "The address-change wait must be whole days (1 to 30).", "BAD_INPUT");
  }
  if (typeof b.sandbox !== "boolean") throw new RelayError(400, "sandbox must be true or false.", "BAD_INPUT");
  return {
    rules: { owner, approvers, caps: toCaps(b.caps), periodLength, changeCooldown, sandbox: b.sandbox },
    validUntil: toValidUntil(b.validUntil, nowSec),
    signature: b.signature,
  };
}

export async function verifyCreateOrg(req: CreateOrgRequest): Promise<void> {
  const ok = await verifyMessage({
    address: req.rules.owner,
    message: createOrgMessage(req.rules, req.validUntil),
    signature: req.signature,
  }).catch(() => false);
  if (!ok) throw new RelayError(400, "The owner did not sign these settings.", "BadSignature");
}

export async function submitCreateOrg(req: CreateOrgRequest): Promise<RelayResult> {
  const { rules } = req;
  const wallet = relayer();
  try {
    const params = initParams({
      ...rules,
      treasury: rules.owner,
      firstBindCooldown: 0n,
      tier: rules.sandbox ? ORG_TIER.SANDBOX : ORG_TIER.PRODUCTION,
    });
    const { request } = await serverClient.simulateContract({
      account: wallet.account,
      address: factory,
      abi: factoryAbiWithErrors,
      functionName: "createMandate",
      args: [params],
    });
    const result = await sendAndWait(() => wallet.writeContract(request));
    if (result.status === "success") {
      const receipt = await serverClient.getTransactionReceipt({ hash: result.txHash });
      const [created] = parseEventLogs({ abi: mandateFactoryAbi, logs: receipt.logs, eventName: "MandateCreated" });
      result.org = created?.args.org;
    }
    return result;
  } catch (err) {
    throw toRelayError(err);
  }
}

export const CREATE_ORG: RelayKind<CreateOrgRequest> = {
  name: "create-org",
  perDay: 50,
  parse: (body) => parseCreateOrg(body),
  verify: verifyCreateOrg,
  payoutOf: (r) => `owner:${r.rules.owner}`,
  submit: submitCreateOrg,
};

// ------------------------------------------------------------------ budget (USDC permit)

export interface PermitRequest {
  message: PermitMessage;
  signature: Hex;
}

export function parsePermit(body: unknown, nowSec = Math.floor(Date.now() / 1000)): PermitRequest {
  const b = toObject(body);
  if (!isSignature(b.signature)) throw new RelayError(400, "signature must be 65 bytes of hex.", "BAD_INPUT");
  return {
    message: {
      owner: toAddress(b.owner, "owner"),
      spender: toAddress(b.spender, "spender"),
      value: toUint(b.value, 256, "value"),
      nonce: toUint(b.nonce, 256, "nonce"),
      deadline: toValidUntil(b.deadline, nowSec),
    },
    signature: b.signature,
  };
}

export async function verifyPermit(req: PermitRequest): Promise<void> {
  const signer = await recoverTypedDataAddress({ ...permitTypedData(req.message), signature: req.signature }).catch(() => null);
  if (signer !== req.message.owner) throw new RelayError(400, "The treasury did not sign this budget.", "BadSignature");
}

export async function submitPermit(req: PermitRequest): Promise<RelayResult> {
  const { message: m, signature } = req;
  const wallet = relayer();
  try {
    // Only budgets for SendSure orgs, and only from the org's own treasury.
    const [isMandate, treasury] = await Promise.all([
      serverClient.readContract({ address: factory, abi: mandateFactoryAbi, functionName: "isMandate", args: [m.spender] }),
      serverClient.readContract({ address: m.spender, abi: mandateAbi, functionName: "treasury" }).catch(() => null),
    ]);
    if (!isMandate) throw new RelayError(400, "That is not a SendSure org.", "NotOrg");
    if (treasury !== m.owner) throw new RelayError(400, "Only the org's treasury can set its budget.", "NotTreasury");
    const { r, s, v, yParity } = parseSignature(signature);
    const { request } = await serverClient.simulateContract({
      account: wallet.account,
      address: deployment.usdc as Address,
      abi: usdcPermitAbi,
      functionName: "permit",
      args: [m.owner, m.spender, m.value, m.deadline, Number(v ?? BigInt(yParity + 27)), r, s],
    });
    return await sendAndWait(() => wallet.writeContract(request));
  } catch (err) {
    throw toRelayError(err);
  }
}

export const PERMIT: RelayKind<PermitRequest> = {
  name: "budget",
  perDay: 100,
  parse: (body) => parsePermit(body),
  verify: verifyPermit,
  payoutOf: (r) => `owner:${r.message.owner}`,
  submit: submitPermit,
};

// ------------------------------------------------------------------ invites (openSlots by the server agent)

let agentClient: ReturnType<typeof makeAgent> | undefined;
function makeAgent() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new RelayError(503, "The SendSure agent is not set up on this server.", "NOT_CONFIGURED");
  const account = privateKeyToAccount(key as Hex, { nonceManager });
  if (account.address !== SENDSURE_AGENTS.serverAgent)
    throw new RelayError(503, "AGENT_PRIVATE_KEY is not the SendSure server agent.", "NOT_CONFIGURED");
  return createWalletClient({ account, chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
}
const agent = () => (agentClient ??= makeAgent());

export const MAX_INVITES_PER_BATCH = 50;
const INVITE_TTL_SECONDS = 15 * 60;
const usedInviteSignatures = new Set<string>();

export interface InvitesRequest {
  org: Address;
  payeeRefs: Hex[];
  validUntil: bigint;
  signature: Hex;
}

export function parseInvites(body: unknown, nowSec = Math.floor(Date.now() / 1000)): InvitesRequest {
  const b = toObject(body);
  if (!isSignature(b.signature)) throw new RelayError(400, "signature must be 65 bytes of hex.", "BAD_INPUT");
  const refs = Array.isArray(b.payeeRefs) ? b.payeeRefs : [];
  if (refs.length < 1 || refs.length > MAX_INVITES_PER_BATCH || !refs.every(isBytes32)) {
    throw new RelayError(400, `Send 1 to ${MAX_INVITES_PER_BATCH} invite ids (32 bytes of hex each).`, "BAD_INPUT");
  }
  if (new Set(refs.map((r) => r.toLowerCase())).size !== refs.length)
    throw new RelayError(400, "Duplicate invite ids.", "BAD_INPUT");
  const validUntil = toValidUntil(b.validUntil, nowSec);
  if (validUntil > BigInt(nowSec + INVITE_TTL_SECONDS))
    throw new RelayError(400, "Invite signatures last at most 15 minutes.", "BAD_INPUT");
  return { org: toAddress(b.org, "org"), payeeRefs: refs, validUntil, signature: b.signature };
}

export async function verifyInvites(req: InvitesRequest): Promise<void> {
  if (usedInviteSignatures.has(req.signature.toLowerCase()))
    throw new RelayError(409, "These invites were already sent.", "NonceUsed");
  const owner = await serverClient.readContract({ address: req.org, abi: mandateAbi, functionName: "owner" }).catch(() => null);
  if (!owner) throw new RelayError(400, "That is not a SendSure org.", "NotOrg");
  const message = openInvitesMessage(req.org, inviteBatchHash(req.payeeRefs), req.payeeRefs.length, req.validUntil);
  const ok = await verifyMessage({ address: owner, message, signature: req.signature }).catch(() => false);
  if (!ok) throw new RelayError(400, "Only the org owner can open invites.", "BadSignature");
}

export async function submitInvites(req: InvitesRequest): Promise<RelayResult> {
  const wallet = agent();
  try {
    const { request } = await serverClient.simulateContract({
      account: wallet.account,
      address: req.org,
      abi: mandateAbiWithErrors,
      functionName: "openSlots",
      args: [req.payeeRefs],
    });
    usedInviteSignatures.add(req.signature.toLowerCase());
    return await sendAndWait(() => wallet.writeContract(request));
  } catch (err) {
    throw toRelayError(err);
  }
}

export const INVITES: RelayKind<InvitesRequest> = {
  name: "invites",
  perDay: 200,
  parse: (body) => parseInvites(body),
  verify: verifyInvites,
  payoutOf: (r) => `org:${r.org}`,
  submit: submitInvites,
  perKey: { max: 30, windowMs: 60 * 60_000 },
};
