// Rehearses the mainnet beta on a local fork of Arc mainnet: run it through scripts/rehearse-mainnet.sh, which
// deploys the contracts there with the real deployer key and starts the web app in mainnet mode. Every check is
// something a real payer or payee will do on mainnet, plus the beta's limits. It never touches the real chain.
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  IS_MAINNET,
  MAINNET_BETA_MAX_CAPS,
  ORG_TIER,
  SENDSURE_AGENTS,
  arc,
  bindTypedData,
  claimTypes,
  createOrgMessage,
  deployment,
  formatUsdc,
  inviteBatchHash,
  mandateAbi,
  mandateDomain,
  openInvitesMessage,
  permitTypedData,
  randomBytes32,
  usdc,
  usdcPermitAbi,
  type CapsInput,
  type Claim,
  type OrgRules,
} from "@sendsure/chain";
import { arg } from "./lib/env";
import { api, bindMessage, check, failed, postRelay, signInAs } from "./lib/relay";

const base = arg("base", "http://127.0.0.1:3100")!;
const rpc = process.env.ARC_RPC_URL ?? "";
if (!IS_MAINNET || arc.id !== 5042) throw new Error("Run with NEXT_PUBLIC_ARC_NETWORK=mainnet (scripts/rehearse-mainnet.sh).");
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc)) throw new Error("ARC_RPC_URL must be the local fork, never the real chain.");

const client = createPublicClient({ chain: arc, transport: http(rpc) });
const fork = createTestClient({ mode: "anvil", chain: arc, transport: http(rpc) });
// anvil's public test key: mints the stand-in USDC on the fork.
const minter = createWalletClient({
  account: privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
  chain: arc,
  transport: http(rpc),
});
const mintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
const USDC = deployment.usdc as Address;
const now = () => BigInt(Math.floor(Date.now() / 1000));
const text = async (path: string) => (await (await fetch(`${base}${path}`)).text()).replace(/<!-- -->/g, "");
const balanceOf = (a: Address) => client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
async function fund(a: Address, amount: string) {
  await fork.setBalance({ address: a, value: 10n ** 20n }); // gas on the fork
  const hash = await minter.writeContract({ address: USDC, abi: mintAbi, functionName: "mint", args: [a, usdc(amount)] });
  await client.waitForTransactionReceipt({ hash });
}

// ------------------------------------------------------------------ 1. the site is the mainnet beta
const status = await api(base, "/api/status");
check(status.body.chain?.id === 5042 && status.body.chain?.name === "Arc mainnet", `status: ${status.body.chain?.name}, chain ${status.body.chain?.id}`);
check(
  status.body.keys?.serverAgent?.address === SENDSURE_AGENTS.serverAgent && !status.body.keys?.circleAgentWallet && !status.body.keys?.faucet,
  `status: the mainnet server agent ${SENDSURE_AGENTS.serverAgent} only; no Circle agent wallet, no faucet`,
);
check(status.body.contracts?.payeeRegistry === deployment.payeeRegistry, `status: PayeeRegistry ${deployment.payeeRegistry}`);
const off: [string, string][] = [
  ["GET", "/api/faucet"],
  ["POST", "/api/faucet"],
  ["GET", "/api/try"],
  ["POST", "/api/try"],
  ["GET", "/api/try/books"],
  ["GET", "/api/x402"],
  ["POST", "/api/x402/check-payout"],
  ["POST", "/api/x402/verify-payee"],
];
for (const [method, path] of off) {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  check(res.status === 404 && body.code === "NOT_ON_MAINNET", `${method} ${path} is off on mainnet (${res.status})`);
}
const home = await text("/");
check(home.includes("Mainnet beta.") && !home.includes('href="/try"') && !home.includes('href="/api/x402"'), "home page: beta bar; demo and x402 links go to the testnet site");
const docs = await text("/docs");
check(docs.includes(deployment.payeeRegistry) && docs.includes("Arc mainnet (chain 5042)") && !docs.includes("0x53f0761fC833064Ca78fc09f6E37aa20eCb21378"), "docs: the mainnet contracts and chain, not the testnet ones");

// ------------------------------------------------------------------ 2. creating an org: the beta's limits
const owner = privateKeyToAccount(generatePrivateKey());
const rules = (over: Partial<OrgRules> = {}): OrgRules => ({
  owner: owner.address,
  approvers: [owner.address],
  caps: DEFAULT_CAPS,
  periodLength: DEFAULT_PERIOD_SECONDS,
  changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
  sandbox: false,
  ...over,
});
async function createOrg(r: OrgRules) {
  const vu = now() + 1800n;
  return api(base, "/api/org/create", { body: { ...r, validUntil: vu, signature: await owner.signMessage({ message: createOrgMessage(r, vu) }) } });
}
check(DEFAULT_CAPS.claimMax === MAINNET_BETA_MAX_CAPS.claimMax, `new orgs default to the beta ceiling: ${formatUsdc(DEFAULT_CAPS.claimMax)} USDC a bill, co-sign above ${formatUsdc(DEFAULT_CAPS.coSignThreshold)}`);
const sandbox = await createOrg(rules({ sandbox: true }));
check(sandbox.status === 400 && sandbox.body.code === "BETA_LIMIT", `a test (sandbox) org is refused: ${sandbox.body.error}`);
const big = await createOrg(rules({ caps: { ...DEFAULT_CAPS, claimMax: usdc(11) } }));
check(big.status === 400 && big.body.code === "BETA_LIMIT", `an org asking for 11 USDC a bill is refused: ${big.body.error}`);
const created = await createOrg(rules());
const org = created.body.org as Address;
check(created.status === 200 && Boolean(org), `org created through the relayer: ${org ?? created.body.error}`);
if (!org) throw new Error("no org: the rest of the rehearsal needs one");
const [agentOk, testnetAgent, tier] = await Promise.all([
  client.readContract({ address: org, abi: mandateAbi, functionName: "isAgent", args: [SENDSURE_AGENTS.serverAgent] }),
  client.readContract({ address: org, abi: mandateAbi, functionName: "isAgent", args: ["0xdE71581E008DD869241C550182A8B2FFa8063E30"] }),
  client.readContract({ address: org, abi: mandateAbi, functionName: "tier" }),
]);
check(agentOk && !testnetAgent && tier === ORG_TIER.PRODUCTION, "on-chain: a production org; its agent is the mainnet server agent, never the testnet one");

// ------------------------------------------------------------------ 3. budget (USDC permit, same domain as real USDC)
await fund(owner.address, "60");
async function permit(value: bigint) {
  const nonce = await client.readContract({ address: USDC, abi: usdcPermitAbi, functionName: "nonces", args: [owner.address] });
  const p = { owner: owner.address, spender: org, value, nonce, deadline: now() + 1800n };
  return api(base, "/api/org/budget", { body: { ...p, signature: await owner.signTypedData(permitTypedData(p)) } });
}
const tooBig = await permit(usdc(101));
check(tooBig.status === 400 && tooBig.body.code === "BETA_LIMIT", `a 101 USDC budget is refused: ${tooBig.body.error}`);
const budget = await permit(usdc(50));
const allowance = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [owner.address, org] });
check(budget.status === 200 && allowance === usdc(50), `budget of ${formatUsdc(allowance)} USDC set by permit, relayed`);

// ------------------------------------------------------------------ 4. invite, and the payee proves their wallet
const payeeRef = randomBytes32();
const ivu = now() + 600n;
const invited = await api(base, "/api/org/invites", {
  body: { org, payeeRefs: [payeeRef], validUntil: ivu, signature: await owner.signMessage({ message: openInvitesMessage(org, inviteBatchHash([payeeRef]), 1, ivu) }) },
});
check(invited.status === 200, `invite opened by the server agent (${invited.body.status ?? invited.body.error})`);
const payee = privateKeyToAccount(generatePrivateKey());
const bm = bindMessage(org, payeeRef, payee.address);
const bound = await postRelay(base, "bind", { ...bm, signature: await payee.signTypedData(bindTypedData(bm)) });
check(bound.status === 200 && bound.body.status === "success", `payee proved their wallet through the relayer (${bound.body.status ?? bound.body.error})`);

// ------------------------------------------------------------------ 5. a bill: escalated, co-signed, paid
const ownerToken = await signInAs(base, owner);
const payeeToken = await signInAs(base, payee);
async function sendClaim(invoiceRef: string, amount: string) {
  const prep = await api(base, "/api/claims/prepare", { token: payeeToken, body: { org, payeeRef, invoiceRef } });
  const claim: Claim = {
    payeeRef,
    token: prep.body.token,
    amount: usdc(amount),
    refHash: prep.body.refHash,
    periodStart: now() - 14n * 86_400n,
    periodEnd: now(),
    nonce: BigInt(prep.body.nonce),
    validUntil: BigInt(prep.body.validUntil),
  };
  const signature = await payee.signTypedData({ domain: mandateDomain(org), types: claimTypes, primaryType: "Claim", message: claim });
  const sent = await api(base, "/api/claims", { body: { org, claim, invoiceRef, description: `Rehearsal ${invoiceRef}`, signature } });
  return sent.body as { claimId: Hex; outcome: string; reason: string; error?: string };
}
const runAgent = async () => (await api(base, "/api/agent/run", { token: ownerToken, body: { org } })).body as Record<string, any>;
const decisionFor = (run: Record<string, any>, claimId: Hex) => (run.decisions as any[] | undefined)?.find((d) => d.claimId === claimId);
async function cosign(claimId: Hex) {
  const view = await api(base, `/api/claims?org=${org}`, { token: ownerToken });
  const claimHex = (view.body.claims as any[]).find((c) => c.claim_id === claimId)?.claim_hex as Hex;
  const approver = createWalletClient({ account: owner, chain: arc, transport: http(rpc) });
  await client.waitForTransactionReceipt({ hash: await approver.writeContract({ address: org, abi: mandateAbi, functionName: "cosign", args: [claimHex] }) });
}

const first = await sendClaim("INV-M1", "2");
check(Boolean(first.claimId), `payee sent a signed 2 USDC claim (${first.outcome ?? first.error})`);
const run1 = await runAgent();
const d1 = decisionFor(run1, first.claimId);
check(d1?.action === "escalate", `run #1: first payment to a new address waits for a person (${d1?.action}: ${d1?.reason})`);
await cosign(first.claimId);
const before = await balanceOf(payee.address);
const run2 = await runAgent();
const d2 = decisionFor(run2, first.claimId);
const paid = (await balanceOf(payee.address)) - before;
check(d2?.action === "pay" && d2?.tx?.outcome === "Settled", `run #2 after the co-sign: ${d2?.action} -> ${d2?.tx?.outcome ?? d2?.error} (planner: ${run2.planner})`);
check(paid === usdc(2), `payee received ${formatUsdc(paid)} USDC at their own address`);
const receipt = d2?.tx?.hash ? await api(base, `/api/receipt?tx=${d2.tx.hash}`) : null;
check(receipt?.status === 200, `public receipt for the payment (${receipt?.status})`);

// ------------------------------------------------------------------ 6. the agent's own ceiling, whatever the org's caps
// The owner can raise caps on-chain without SendSure; the agent still never pays above the beta's limit.
const raised: CapsInput = { orgPeriodCap: usdc(100), payeePeriodCap: usdc(50), claimMax: usdc(20), coSignThreshold: usdc(5) };
const ownerWallet = createWalletClient({ account: owner, chain: arc, transport: http(rpc) });
await client.waitForTransactionReceipt({
  hash: await ownerWallet.writeContract({ address: org, abi: mandateAbi, functionName: "setCaps", args: [USDC, raised] }),
});
const big2 = await sendClaim("INV-M2", "15");
await runAgent(); // escalated: above the co-sign threshold
await cosign(big2.claimId);
const before2 = await balanceOf(payee.address);
const run3 = await runAgent();
const d3 = decisionFor(run3, big2.claimId);
const paid2 = (await balanceOf(payee.address)) - before2;
check(
  d3?.action === "hold" && /mainnet beta limit/.test(String(d3?.reason)) && !d3?.tx && paid2 === 0n,
  `a co-signed 15 USDC bill in an org that raised its own caps is held, not paid (${d3?.action}: ${d3?.reason})`,
);

// ------------------------------------------------------------------ 7. the chain index and the numbers
const tick = await fetch(`${base}/api/indexer/tick`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" } });
check(tick.status === 200, `indexer tick on mainnet settings (${tick.status})`);
const stats = await api(base, "/api/stats");
check(stats.status === 200, `dashboard numbers (${stats.status})`);

console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed: the mainnet beta works end to end on a fork of Arc mainnet");
process.exitCode = failed() ? 1 : 0;
