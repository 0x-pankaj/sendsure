// End-to-end check of gasless payer onboarding through the web server, on Arc testnet.
// First-party test with a throwaway key; the org is created with tier SANDBOX. Not traction.
//   1. a stranger cannot create an org in someone else's name
//   2. the owner signs its rules as plain text: the relayer creates the org (tier SANDBOX)
//   3. the owner signs a USDC permit: the org gets a capped allowance, no gas paid by the owner
//   4. a stranger cannot open invites for the org; the owner can (the SendSure agent submits)
//   5. replaying the owner's invites signature is refused
//   6. a payee binds one of the invites through the relayer
//   pnpm tsx scripts/e2e-org.ts [--base http://localhost:3000]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  ORG_TIER,
  arcTestnet,
  bindTypedData,
  createOrgMessage,
  deployment,
  explorerTx,
  formatUsdc,
  inviteBatchHash,
  openInvitesMessage,
  permitTypedData,
  randomBytes32,
  readMandate,
  readPayee,
  usdc,
  usdcPermitAbi,
  type OrgRules,
} from "@sendsure/chain";
import { arg } from "./lib/env";
import { bindMessage, check, failed, postRelay, withChecks } from "./lib/relay";

const base = arg("base", "http://localhost:3000")!;
const client = createPublicClient({ chain: arcTestnet, transport: http() });
const now = () => BigInt(Math.floor(Date.now() / 1000));

async function post(path: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
  return { status: res.status, body: (await res.json()) as { txHash?: Hex; status?: string; org?: Address; error?: string; code?: string } };
}

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const rules: OrgRules = {
  owner: owner.address,
  approvers: [owner.address],
  caps: DEFAULT_CAPS,
  periodLength: DEFAULT_PERIOD_SECONDS,
  changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
  sandbox: true,
};
const validUntil = now() + 1800n;
const createBody = (signature: Hex) => ({ ...rules, validUntil, signature });

// 1. A stranger signs the owner's rules.
const r1 = await post("/api/org/create", createBody(await stranger.signMessage({ message: createOrgMessage(rules, validUntil) })));
check(r1.status === 400 && r1.body.code === "BadSignature", `org in someone else's name refused (${r1.status} ${r1.body.error})`);

// 2. The owner signs its own rules.
const r2 = await post("/api/org/create", createBody(await owner.signMessage({ message: createOrgMessage(rules, validUntil) })));
check(r2.status === 200 && r2.body.status === "success" && Boolean(r2.body.org), `org created (${r2.status} ${r2.body.org ?? r2.body.error})`);
const org = r2.body.org!;
const m = await readMandate(client, org);
check(m.owner === owner.address && m.treasury === owner.address && m.tier === ORG_TIER.SANDBOX, `owner = treasury = the key; tier SANDBOX`);
check(m.caps.orgPeriodCap === DEFAULT_CAPS.orgPeriodCap && m.circleAgentAllowed, `caps as signed; Circle agent wallet allowed`);

// 3. Budget by permit.
const nonce = await client.readContract({ address: deployment.usdc as Address, abi: usdcPermitAbi, functionName: "nonces", args: [owner.address] });
const permit = { owner: owner.address, spender: org, value: usdc(10), nonce, deadline: now() + 1800n };
const r3 = await post("/api/org/budget", { ...permit, signature: await owner.signTypedData(permitTypedData(permit)) });
const m3 = await readMandate(client, org);
check(r3.status === 200 && m3.allowance === usdc(10), `budget set by permit: allowance ${formatUsdc(m3.allowance)} USDC (${r3.status})`);

// 4. Invites: a stranger first, then the owner.
const refs = [randomBytes32(), randomBytes32()];
const inviteValidUntil = now() + 600n;
const inviteText = openInvitesMessage(org, inviteBatchHash(refs), refs.length, inviteValidUntil);
const inviteBody = (signature: Hex) => ({ org, payeeRefs: refs, validUntil: inviteValidUntil, signature });
const r4a = await post("/api/org/invites", inviteBody(await stranger.signMessage({ message: inviteText })));
check(r4a.status === 400 && r4a.body.code === "BadSignature", `stranger's invites refused (${r4a.status} ${r4a.body.error})`);
const ownerInviteSig = await owner.signMessage({ message: inviteText });
const r4 = await post("/api/org/invites", inviteBody(ownerInviteSig));
const states = await Promise.all(refs.map((ref) => readPayee(client, org, ref)));
check(r4.status === 200 && states.every((p) => p.state === "OPEN"), `owner's 2 invites opened by the SendSure agent (${r4.status})`);

// 5. Replay.
const r5 = await post("/api/org/invites", inviteBody(ownerInviteSig));
check(r5.status === 409, `invites replay refused (${r5.status} ${r5.body.code})`);

// 6. A payee binds the first invite.
const payee = privateKeyToAccount(generatePrivateKey());
const bind = bindMessage(org, refs[0]!, payee.address);
const r6 = await postRelay(base, "bind", { ...bind, signature: await payee.signTypedData(bindTypedData(bind)) });
const p6 = await readPayee(client, org, refs[0]!);
check(r6.status === 200 && p6.state === "BOUND" && p6.payout === payee.address, `payee bound to the new org (${p6.state})`);

const out = {
  note: "First-party end-to-end test with throwaway keys; org tier SANDBOX. Not traction.",
  ranAtUnix: Number(now()),
  base,
  org,
  owner: owner.address,
  checks: {
    strangerCreate: `${r1.status} ${r1.body.code}`,
    created: `${r2.status} tier ${m.tier}`,
    allowanceUsdc: formatUsdc(m3.allowance),
    strangerInvites: `${r4a.status} ${r4a.body.code}`,
    invitesOpened: states.map((p) => p.state),
    invitesReplay: `${r5.status} ${r5.body.code}`,
    payeeBound: p6.state,
  },
  links: {
    createOrg: r2.body.txHash ? explorerTx(r2.body.txHash) : null,
    budget: r3.body.txHash ? explorerTx(r3.body.txHash) : null,
    invites: r4.body.txHash ? explorerTx(r4.body.txHash) : null,
    bind: r6.body.txHash ? explorerTx(r6.body.txHash) : null,
  },
};
writeFileSync(resolve(import.meta.dirname, "../deployments/org-e2e.json"), `${JSON.stringify(withChecks(out), null, 2)}\n`);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/org-e2e.json");
process.exitCode = failed() ? 1 : 0;
