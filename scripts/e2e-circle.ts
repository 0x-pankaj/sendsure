// End-to-end check: the Circle agent wallet (Circle CLI) is the one that pays, on Arc testnet.
// First-party test with throwaway keys on a SANDBOX org. Not traction.
//   1. sandbox org + bound payee; the payee claims 0.2 USDC (first payment: needs a co-sign)
//   2. the owner co-signs the exact claim on-chain
//   3. the Circle agent wallet signs in (ERC-1271), asks SendSure for a plan, and sends settle() itself
//      with the logged decision hash; SendSure records the tx only after reading it from the chain
//   4. the Circle agent wallet anchors the decision log head; replay verifies the decision
//   pnpm tsx scripts/e2e-circle.ts [--base https://sendsure.0xpankaj.workers.dev]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { erc20Abi, parseEventLogs, type Address } from "viem";
import { deployment, explorerTx, formatUsdc, mandateAbi, usdc } from "@sendsure/chain";
import { CIRCLE_AGENT, runWithCircle, signInAsCircleAgent } from "./agent-circle";
import { arg, loadEnv } from "./lib/env";
import { client, cosignAsOwner, sendClaim, setupSandboxOrg } from "./lib/flows";
import { api, check, failed } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const s = await setupSandboxOrg(base, "0.5");
check(true, `sandbox org ${s.org} with a bound payee`);
const c = await sendClaim(s, "INV-C", "0.2", "Illustrations for the landing page");
check(c.outcome === "ESCALATED", `claim INV-C stored: ${c.outcome} ${c.reason}`);
const cosignTx = await cosignAsOwner(s, c.claimId);
check(true, `owner co-signed on-chain: ${explorerTx(cosignTx)}`);

const token = await signInAsCircleAgent(base);
check(Boolean(token), `Circle agent wallet ${CIRCLE_AGENT} signed in (ERC-1271 signature checked on-chain)`);
const before = await client.readContract({
  address: deployment.usdc as Address,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [s.payee.address],
});
const out = await runWithCircle(base, s.org, token);
const ex = out.executions[0];
const after = await client.readContract({
  address: deployment.usdc as Address,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [s.payee.address],
});
check(ex?.outcome === "Settled", `Circle agent wallet sent settle(): ${ex?.outcome} ${ex ? explorerTx(ex.txHash) : ""}`);
check(after - before === usdc("0.2"), `payee received ${formatUsdc(after - before)} USDC`);

let decisionHashOnChain: string | undefined;
if (ex) {
  const receipt = await client.getTransactionReceipt({ hash: ex.txHash });
  const [ev] = parseEventLogs({ abi: mandateAbi, logs: receipt.logs, eventName: "Settled" });
  decisionHashOnChain = ev?.args.decisionHash;
}
const decision = out.plan.decisions.find((d) => d.seq === ex?.seq);
check(decisionHashOnChain === decision?.decisionHash, `Settled carries the logged decision hash`);
check(
  Boolean(out.anchor),
  `Circle agent wallet anchored the log: #${out.anchor?.anchorSeq} ${out.anchor ? explorerTx(out.anchor.txHash) : ""}`,
);

const claims = await api(base, `/api/claims?org=${s.org}`, { token: s.ownerToken });
const row = (claims.body.claims as { claim_id: string; status: string; settle_tx: string }[]).find(
  (x) => x.claim_id === c.claimId,
);
check(row?.status === "settled" && row.settle_tx === ex?.txHash, `SendSure recorded the claim as settled with the Circle tx`);
const replay = (await api(base, `/api/agent/replay?org=${s.org}&seq=${ex?.seq}`, { token: s.ownerToken })).body as Record<
  string,
  any
>;
check(
  replay.chainIntact &&
    replay.signatureOk &&
    replay.checkAtBlock?.matches &&
    replay.payment?.carriesDecisionHash &&
    replay.anchored?.matches,
  `replay verified`,
);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/circle-e2e.json"),
  `${JSON.stringify(
    {
      note: "First-party end-to-end test: the Circle agent wallet (Circle CLI) settles a SANDBOX org's claim. Throwaway keys, not traction.",
      ranAtUnix: Math.floor(Date.now() / 1000),
      base,
      org: s.org,
      circleAgentWallet: CIRCLE_AGENT,
      payee: s.payee.address,
      cosign: explorerTx(cosignTx),
      settle: ex ? explorerTx(ex.txHash) : null,
      decisionHash: decision?.decisionHash,
      anchor: out.anchor ? explorerTx(out.anchor.txHash) : null,
      replay: {
        chainIntact: replay.chainIntact,
        signatureOk: replay.signatureOk,
        checkAtBlock: replay.checkAtBlock,
        anchored: replay.anchored,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/circle-e2e.json");
process.exitCode = failed() ? 1 : 0;
