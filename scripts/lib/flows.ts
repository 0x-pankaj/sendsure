// Shared test flows: a funded sandbox org with one bound payee, claims, and the owner's co-sign.
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  arcTestnet,
  bindTypedData,
  claimTypes,
  createOrgMessage,
  deployment,
  inviteBatchHash,
  mandateAbi,
  mandateDomain,
  openInvitesMessage,
  permitTypedData,
  randomBytes32,
  usdc,
  usdcPermitAbi,
  type Claim,
  type OrgRules,
} from "@sendsure/chain";
import { need } from "./env";
import { api, bindMessage, postRelay, signInAs } from "./relay";

export const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
const now = () => BigInt(Math.floor(Date.now() / 1000));

export interface SandboxOrg {
  base: string;
  org: Address;
  owner: PrivateKeyAccount;
  payee: PrivateKeyAccount;
  payeeRef: Hex;
  ownerToken: string;
  payeeToken: string;
}

/** A SANDBOX org (throwaway owner = treasury = approver), funded, with a 10 USDC budget and one bound payee. */
export async function setupSandboxOrg(base: string, fundUsdc: string): Promise<SandboxOrg> {
  const owner = privateKeyToAccount(generatePrivateKey());
  const rules: OrgRules = {
    owner: owner.address,
    approvers: [owner.address],
    caps: DEFAULT_CAPS,
    periodLength: DEFAULT_PERIOD_SECONDS,
    changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
    sandbox: true,
  };
  const vu = now() + 1800n;
  const created = await api(base, "/api/org/create", {
    body: { ...rules, validUntil: vu, signature: await owner.signMessage({ message: createOrgMessage(rules, vu) }) },
  });
  if (created.status !== 200 || !created.body.org) throw new Error(`org not created: ${JSON.stringify(created.body)}`);
  const org = created.body.org as Address;
  const funder = createWalletClient({
    account: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex),
    chain: arcTestnet,
    transport: http(),
  });
  await client.waitForTransactionReceipt({
    hash: await funder.sendTransaction({ to: owner.address, value: parseEther(fundUsdc) }),
  });
  const nonce = await client.readContract({
    address: deployment.usdc as Address,
    abi: usdcPermitAbi,
    functionName: "nonces",
    args: [owner.address],
  });
  const permit = { owner: owner.address, spender: org, value: usdc(10), nonce, deadline: now() + 1800n };
  await api(base, "/api/org/budget", { body: { ...permit, signature: await owner.signTypedData(permitTypedData(permit)) } });
  const payeeRef = randomBytes32();
  const ivu = now() + 600n;
  await api(base, "/api/org/invites", {
    body: {
      org,
      payeeRefs: [payeeRef],
      validUntil: ivu,
      signature: await owner.signMessage({ message: openInvitesMessage(org, inviteBatchHash([payeeRef]), 1, ivu) }),
    },
  });
  const payee = privateKeyToAccount(generatePrivateKey());
  const bm = bindMessage(org, payeeRef, payee.address);
  const bound = await postRelay(base, "bind", { ...bm, signature: await payee.signTypedData(bindTypedData(bm)) });
  if (bound.status !== 200) throw new Error(`payee not bound: ${JSON.stringify(bound.body)}`);
  return { base, org, owner, payee, payeeRef, ownerToken: await signInAs(base, owner), payeeToken: await signInAs(base, payee) };
}

/** The payee prepares, signs and sends one claim, like the verify page does. */
export async function sendClaim(s: SandboxOrg, invoiceRef: string, amount: string, description: string) {
  const prep = await api(s.base, "/api/claims/prepare", {
    token: s.payeeToken,
    body: { org: s.org, payeeRef: s.payeeRef, invoiceRef },
  });
  const claim: Claim = {
    payeeRef: s.payeeRef,
    token: prep.body.token,
    amount: usdc(amount),
    refHash: prep.body.refHash,
    periodStart: now() - 14n * 86_400n,
    periodEnd: now(),
    nonce: BigInt(prep.body.nonce),
    validUntil: BigInt(prep.body.validUntil),
  };
  const signature = await s.payee.signTypedData({
    domain: mandateDomain(s.org),
    types: claimTypes,
    primaryType: "Claim",
    message: claim,
  });
  const sent = await api(s.base, "/api/claims", { body: { org: s.org, claim, invoiceRef, description, signature } });
  return sent.body as { claimId: Hex; outcome: string; reason: string };
}

/** The owner (also the approver) co-signs one exact claim on-chain. */
export async function cosignAsOwner(s: SandboxOrg, claimId: Hex): Promise<Hex> {
  const view = await api(s.base, `/api/claims?org=${s.org}`, { token: s.ownerToken });
  const claimHex = (view.body.claims as { claim_id: Hex; claim_hex: Hex }[]).find((c) => c.claim_id === claimId)?.claim_hex;
  if (!claimHex) throw new Error("claim not found for co-sign");
  const wallet = createWalletClient({
    account: s.owner,
    chain: arcTestnet,
    transport: http(process.env.ARC_RPC_URL || undefined),
  });
  const tx = await wallet.writeContract({ address: s.org, abi: mandateAbi, functionName: "cosign", args: [claimHex] });
  await client.waitForTransactionReceipt({ hash: tx });
  return tx;
}
