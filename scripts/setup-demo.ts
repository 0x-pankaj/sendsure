// One-time setup of the /try demo org (tier SANDBOX): its own owner/treasury and approver keys,
// a funded treasury and a budget. Writes DEMO_* into apps/web/.env.local (never printed).
//   pnpm tsx scripts/setup-demo.ts [--base https://sendsure.0xpankaj.workers.dev] [--fund 3]
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, getAddress, http, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  arcTestnet,
  createOrgMessage,
  deployment,
  explorerTx,
  permitTypedData,
  usdc,
  usdcPermitAbi,
  type OrgRules,
} from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { client } from "./lib/flows";
import { api } from "./lib/relay";

loadEnv();
const envFile = resolve(import.meta.dirname, "../apps/web/.env.local");
if (/^DEMO_ORG=/m.test(readFileSync(envFile, "utf8"))) throw new Error("DEMO_ORG already set in apps/web/.env.local");
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const fund = arg("fund", "3")!;

const ownerKey = generatePrivateKey();
const approverKey = generatePrivateKey();
const owner = privateKeyToAccount(ownerKey);
const approver = privateKeyToAccount(approverKey);
const rules: OrgRules = {
  owner: owner.address,
  approvers: [approver.address],
  caps: { orgPeriodCap: usdc(20), payeePeriodCap: usdc(1), claimMax: usdc("0.5"), coSignThreshold: usdc("0.25") },
  periodLength: DEFAULT_PERIOD_SECONDS,
  changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
  sandbox: true,
};
const vu = BigInt(Math.floor(Date.now() / 1000) + 1800);
const created = await api(base, "/api/org/create", {
  body: { ...rules, validUntil: vu, signature: await owner.signMessage({ message: createOrgMessage(rules, vu) }) },
});
if (created.status !== 200 || !created.body.org) throw new Error(`org not created: ${JSON.stringify(created.body)}`);
const org = getAddress(created.body.org);

const funder = createWalletClient({ account: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex), chain: arcTestnet, transport: http() });
await client.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: owner.address, value: parseEther(fund) }) });
await client.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: approver.address, value: parseEther("0.2") }) });
const nonce = await client.readContract({ address: deployment.usdc as Hex, abi: usdcPermitAbi, functionName: "nonces", args: [owner.address] });
const permit = { owner: owner.address, spender: org, value: usdc(fund), nonce, deadline: vu };
const budget = await api(base, "/api/org/budget", { body: { ...permit, signature: await owner.signTypedData(permitTypedData(permit)) } });
if (budget.status !== 200) throw new Error(`budget not set: ${JSON.stringify(budget.body)}`);

const secret = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
appendFileSync(
  envFile,
  [
    "# /try demo org (SANDBOX). Owner = treasury; approver co-signs demo payments. Never commit.",
    `DEMO_ORG=${org}`,
    `DEMO_OWNER_PRIVATE_KEY=${ownerKey}`,
    `DEMO_APPROVER_PRIVATE_KEY=${approverKey}`,
    `DEMO_SECRET=${secret}`,
    "",
  ].join("\n"),
);
console.log(`demo org ${org} (owner ${owner.address}, approver ${approver.address})`);
console.log(`created: ${explorerTx(created.body.txHash)} · budget: ${explorerTx(budget.body.txHash)} · treasury funded with ${fund} USDC`);
