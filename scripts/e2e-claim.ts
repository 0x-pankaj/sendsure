// End-to-end check of claims on Arc testnet through the web server.
// First-party test with throwaway keys on a SANDBOX org. Not traction.
//   1. a sandbox org is created (gasless), its treasury gets 1 USDC, and it sets a 10 USDC budget
//   2. a payee is invited and binds a fresh address
//   3. the payee signs in, prepares and signs a 0.5 USDC claim for INV-E2E-1: the contract's own
//      check() says ESCALATED (first payment to a new address needs a co-sign), and it is stored
//   4. the same invoice typed differently is refused; a claim signed by another key is refused;
//      a claim whose invoice number does not match its refHash is refused
//   5. the owner sees the claim; a stranger cannot
//   pnpm tsx scripts/e2e-claim.ts [--base http://localhost:3000]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  arcTestnet,
  bindTypedData,
  claimTypes,
  createOrgMessage,
  deployment,
  explorerTx,
  inviteBatchHash,
  mandateDomain,
  openInvitesMessage,
  permitTypedData,
  randomBytes32,
  usdc,
  usdcPermitAbi,
  type Claim,
  type OrgRules,
} from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { api, bindMessage, check, failed, postRelay, signInAs } from "./lib/relay";

loadEnv();
const base = arg("base", "http://localhost:3000")!;
const client = createPublicClient({ chain: arcTestnet, transport: http() });
const now = () => BigInt(Math.floor(Date.now() / 1000));

// 1. Org + funded treasury + budget.
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
const org = created.body.org as Address;
check(created.status === 200 && Boolean(org), `sandbox org created ${org}`);
const funder = createWalletClient({ account: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex), chain: arcTestnet, transport: http() });
await client.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: owner.address, value: parseEther("1") }) });
const nonce = await client.readContract({ address: deployment.usdc as Address, abi: usdcPermitAbi, functionName: "nonces", args: [owner.address] });
const permit = { owner: owner.address, spender: org, value: usdc(10), nonce, deadline: now() + 1800n };
const budget = await api(base, "/api/org/budget", { body: { ...permit, signature: await owner.signTypedData(permitTypedData(permit)) } });
check(budget.status === 200, `treasury funded with 1 USDC, budget 10 USDC`);

// 2. Invite + bind.
const payeeRef = randomBytes32();
const ivu = now() + 600n;
const inv = await api(base, "/api/org/invites", {
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
check(inv.status === 200 && bound.status === 200, `payee invited and bound`);

// 3. The payee's claim.
const payeeToken = await signInAs(base, payee);
const prep = await api(base, "/api/claims/prepare", { token: payeeToken, body: { org, payeeRef, invoiceRef: " INV-E2E-1 " } });
check(prep.status === 200 && prep.body.invoiceRef === "INV-E2E-1", `prepared (invoice normalized to ${prep.body.invoiceRef})`);
const claim: Claim = {
  payeeRef,
  token: prep.body.token,
  amount: usdc("0.5"),
  refHash: prep.body.refHash,
  periodStart: now() - 7n * 86_400n,
  periodEnd: now(),
  nonce: BigInt(prep.body.nonce),
  validUntil: BigInt(prep.body.validUntil),
};
const typed = { domain: mandateDomain(org), types: claimTypes, primaryType: "Claim", message: claim } as const;
const submit = (signature: Hex, invoiceRef = "INV-E2E-1") =>
  api(base, "/api/claims", { body: { org, claim, invoiceRef, description: "Design work, week 39", signature } });
const sent = await submit(await payee.signTypedData(typed));
check(
  sent.status === 200 && sent.body.outcome === "ESCALATED" && sent.body.reason === "NEEDS_COSIGN_NEW_PAYOUT",
  `claim stored; check() says ${sent.body.outcome} ${sent.body.reason}`,
);

// 4. Refusals.
const dup = await api(base, "/api/claims/prepare", { token: payeeToken, body: { org, payeeRef, invoiceRef: "inv-e2e-1" } });
check(dup.status === 409 && dup.body.code === "DUPLICATE_REF", `same invoice typed differently refused (${dup.body.error})`);
const intruder = privateKeyToAccount(generatePrivateKey());
const forged = await submit(await intruder.signTypedData(typed));
check(forged.status === 400 && forged.body.code === "BAD_SIGNATURE", `claim signed by another key refused (${forged.body.error})`);
const mismatch = await submit(await payee.signTypedData(typed), "INV-E2E-2");
check(mismatch.status === 400, `invoice number that does not match the signed refHash refused (${mismatch.body.error})`);

// 5. Who can see it.
const ownerView = await api(base, `/api/claims?org=${org}`, { token: await signInAs(base, owner) });
check(ownerView.status === 200 && ownerView.body.claims.length === 1, `owner sees ${ownerView.body.claims?.length} claim`);
const strangerView = await api(base, `/api/claims?org=${org}`, { token: await signInAs(base, intruder) });
check(strangerView.status === 403, `stranger cannot list the org's claims (${strangerView.status})`);
const payeeView = await api(base, `/api/claims?org=${org}&ref=${payeeRef}`, { token: payeeToken });
check(payeeView.status === 200 && payeeView.body.claims[0]?.invoice_ref === "INV-E2E-1", `payee sees their own claim`);

const out = {
  note: "First-party end-to-end test with throwaway keys on a SANDBOX org. Not traction.",
  ranAtUnix: Number(now()),
  base,
  org,
  payee: payee.address,
  claimId: sent.body.claimId,
  checks: {
    stored: `${sent.body.outcome} ${sent.body.reason}`,
    duplicate: dup.body.code,
    forged: forged.body.code,
    mismatch: mismatch.status,
    ownerSees: ownerView.body.claims?.length,
    strangerSees: strangerView.status,
  },
  links: { createOrg: created.body.txHash ? explorerTx(created.body.txHash) : null, bind: bound.body.txHash ? explorerTx(bound.body.txHash) : null },
};
writeFileSync(resolve(import.meta.dirname, "../deployments/claim-e2e.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/claim-e2e.json");
process.exitCode = failed() ? 1 : 0;
