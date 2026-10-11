// End-to-end: a payee who cannot sign (a passkey smart account) authorises a claim by SENDING it on Arc from
// the proven address (Mandate.submitClaim), and SendSure stores, checks, pays and replays it with no signature.
// A plain wallet stands in for the passkey account here (the contract only looks at msg.sender); the passkey
// flow itself is the same calls sent as a Circle user operation. First-party test on a SANDBOX org. Not traction.
//   pnpm tsx scripts/e2e-onchain-claim.ts [--base https://sendsure.0xpankaj.workers.dev]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, erc20Abi, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, deployment, encodeClaim, formatUsdc, mandateAbi, usdc, type Claim } from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { client, cosignAsOwner, setupSandboxOrg } from "./lib/flows";
import { api, check, failed, signInAs, withChecks } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const rpc = http(process.env.ARC_RPC_URL || undefined);
const USDC = deployment.usdc as Address;
const now = () => BigInt(Math.floor(Date.now() / 1000));

const s = await setupSandboxOrg(base, "0.5");
check(true, `sandbox org ${s.org} with a bound payee ${s.payee.address}`);

// The payee's account sends its own transactions here, so it needs a little gas (a passkey account gets it from Gas Station).
const funder = createWalletClient({ account: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex), chain: arcTestnet, transport: rpc });
await client.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: s.payee.address, value: parseEther("0.05") }) });
const payeeWallet = createWalletClient({ account: s.payee, chain: arcTestnet, transport: rpc });

async function prepare(invoiceRef: string, amount: string): Promise<Claim> {
  const prep = await api(base, "/api/claims/prepare", { token: s.payeeToken, body: { org: s.org, payeeRef: s.payeeRef, invoiceRef } });
  return {
    payeeRef: s.payeeRef,
    token: prep.body.token,
    amount: usdc(amount),
    refHash: prep.body.refHash,
    periodStart: now() - 14n * 86_400n,
    periodEnd: now(),
    nonce: BigInt(prep.body.nonce),
    validUntil: BigInt(prep.body.validUntil),
  };
}
const post = (claim: Claim, invoiceRef: string) =>
  api(base, "/api/claims", { body: { org: s.org, claim, invoiceRef, description: "Brand guide, sent from the payee's own account", onchain: true } });

// 1. Not sent on Arc: refused, nothing stored.
const unsent = await prepare("INV-OC-0", "0.1");
const r0 = await post(unsent, "INV-OC-0");
check(r0.status === 400 && r0.body.code === "NOT_SUBMITTED", `a claim with no signature that was never sent on Arc is refused (${r0.status} ${r0.body.code})`);

// 2. Sent on Arc from the proven address: stored and checked by the contract with no signature.
const claim = await prepare("INV-OC-1", "0.2");
const submitTx = await payeeWallet.writeContract({ address: s.org, abi: mandateAbi, functionName: "submitClaim", args: [encodeClaim(claim)] });
await client.waitForTransactionReceipt({ hash: submitTx });
check(true, `the payee's account sent submitClaim() on Arc: https://explorer.testnet.arc.io/tx/${submitTx}`);
const r1 = await post(claim, "INV-OC-1");
check(r1.status === 200 && r1.body.outcome === "ESCALATED", `SendSure stored it with no signature: ${r1.body.outcome} ${r1.body.reason} (${r1.status})`);
const claimId = r1.body.claimId as Hex;

// 3. The owner co-signs; the agent pays it with an empty signature (the contract accepts the on-chain submission).
await cosignAsOwner(s, claimId);
const before = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [s.payee.address] });
const run = (await api(base, "/api/agent/run", { token: s.ownerToken, body: { org: s.org } })).body as Record<string, any>;
const d = (run.decisions as any[] | undefined)?.find((x) => x.claimId === claimId);
const after = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [s.payee.address] });
check(d?.action === "pay" && d?.tx?.outcome === "Settled", `the agent paid it: ${d?.action} -> ${d?.tx?.outcome} ${d?.tx?.hash ?? ""}`);
check(after - before === usdc("0.2"), `the payee's proven address received ${formatUsdc(after - before)} USDC`);

// 4. Replay: the authorisation is the on-chain submission at the decision's block.
const replay = (await api(base, `/api/agent/replay?org=${s.org}&seq=${d?.seq}`, { token: s.ownerToken })).body as Record<string, any>;
check(replay.signatureOk && replay.checkAtBlock?.matches && replay.payment?.carriesDecisionHash, `replay: authorised on-chain by the payee, check() matches at block ${replay.checkAtBlock?.block}, payment carries the decision hash`);

// 5. The page closes right after the claim goes on Arc (it never tells SendSure). The page left the claim with
//    SendSure first, so SendSure records it by itself once Arc shows it was sent: here when the payee opens their claims.
const closed = await prepare("INV-OC-3", "0.1");
const intent = await api(base, "/api/claims", {
  token: s.payeeToken,
  body: { org: s.org, claim: closed, invoiceRef: "INV-OC-3", description: "Sent, then the tab closed", onchain: true, intent: true },
});
check(intent.status === 200 && intent.body.intent === true, `SendSure kept the claim before it went on Arc (${intent.status})`);
const strangerToken = await signInAs(base, privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex));
const notYours = await api(base, "/api/claims", {
  token: strangerToken,
  body: { org: s.org, claim: closed, invoiceRef: "INV-OC-3", onchain: true, intent: true },
});
check(notYours.status === 403, `only the payee's own wallet can leave a claim for them (${notYours.status} ${notYours.body.code})`);
await client.waitForTransactionReceipt({
  hash: await payeeWallet.writeContract({ address: s.org, abi: mandateAbi, functionName: "submitClaim", args: [encodeClaim(closed)] }),
});
const mine = await api(base, `/api/claims?org=${s.org}&ref=${s.payeeRef}`, { token: s.payeeToken });
const found = (mine.body.claims as any[] | undefined)?.find((c) => c.invoice_ref === "INV-OC-3");
check(found?.status === "open" && found?.description === "Sent, then the tab closed", `recorded from Arc with no word from the page: ${found?.status} ${found?.last_outcome}`);
const late = await api(base, "/api/claims", { body: { org: s.org, claim: closed, invoiceRef: "INV-OC-3", onchain: true } });
check(late.status === 200 && late.body.claimId === found?.claim_id, `the page's late message gets the same answer, nothing stored twice (${late.status})`);

// 6. A claim sent on Arc before this existed (no copy at SendSure) holds its invoice number: the payee hears why
//    before trying again, instead of a reverted transaction.
const orphan = await prepare("INV-OC-4", "0.1");
await client.waitForTransactionReceipt({
  hash: await payeeWallet.writeContract({ address: s.org, abi: mandateAbi, functionName: "submitClaim", args: [encodeClaim(orphan)] }),
});
const again = await api(base, "/api/claims/prepare", { token: s.payeeToken, body: { org: s.org, payeeRef: s.payeeRef, invoiceRef: "INV-OC-4" } });
check(again.status === 409 && again.body.code === "REF_HELD_ON_ARC", `the same invoice number again is explained, not reverted (${again.status} ${again.body.code})`);

// 7. Someone else cannot submit a claim for this payee.
const stranger = createWalletClient({ account: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex), chain: arcTestnet, transport: rpc });
const forged = await prepare("INV-OC-2", "0.2");
const refused = await stranger
  .writeContract({ address: s.org, abi: mandateAbi, functionName: "submitClaim", args: [encodeClaim(forged)] })
  .then(() => "sent")
  .catch((e: Error) => (/NotPayee/.test(e.message) ? "NotPayee" : e.message.slice(0, 80)));
check(refused === "NotPayee", `another address cannot submit a claim for this payee (${refused})`);

const out = { note: "First-party test on a SANDBOX org with throwaway keys. Not traction.", ranAtUnix: Math.floor(Date.now() / 1000), base, org: s.org, payee: s.payee.address, submitTx, payment: d?.tx?.hash ?? null };
writeFileSync(resolve(import.meta.dirname, "../deployments/onchain-claim-e2e.json"), `${JSON.stringify(withChecks(out), null, 2)}\n`);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/onchain-claim-e2e.json");
process.exit(failed() ? 1 : 0);
