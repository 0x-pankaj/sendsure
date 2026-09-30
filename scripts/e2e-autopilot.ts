// End-to-end check: autopilot and the cash plan, against the live SendSure on Arc testnet.
// Nobody calls "run the agent" in this script: every run below is started by the Worker's cron.
// First-party test with throwaway keys on a SANDBOX org. Not traction.
//   1. the owner turns autopilot on (a payee cannot)
//   2. a payee signs a claim: the agent runs by itself and asks for a co-sign (first payment to a new address)
//   3. nothing changes for two more ticks: the agent does not run again
//   4. the owner co-signs on-chain: the agent runs by itself and pays
//   5. two more co-signed claims that do not fit together in the treasury: the agent pays the oldest work
//      and makes the other wait, with the amount that is short
//   6. the treasury is topped up: the agent runs by itself and pays the one that waited
//   7. the owner turns autopilot off
//   pnpm tsx scripts/e2e-autopilot.ts [--base https://sendsure.0xpankaj.workers.dev]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, erc20Abi, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, deployment, explorerTx, formatUsdc, usdc } from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { client, cosignAsOwner, sendClaim, setupSandboxOrg } from "./lib/flows";
import { api, check, failed, withChecks } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const USDC = deployment.usdc as Address;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const balanceOf = (who: Address) => client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [who] });

const s = await setupSandboxOrg(base, "0.7");
const { org, ownerToken } = s;

type Run = { run_id: string; trigger: string; summary: string; cash: Record<string, string> | null };
type Decision = { run_id: string; claim_id: Hex; action: string; reason: string; tx_hash: Hex | null; tx_outcome: string | null };
const log = async () => (await api(base, `/api/agent/runs?org=${org}`, { token: ownerToken })).body as { runs: Run[]; decisions: Decision[] };
const setAutopilot = (token: string, enabled: boolean) => api(base, "/api/org/autopilot", { token, body: { org, enabled } });

/** Wait for the cron to start a new run (there were `known` runs before). */
async function nextRun(known: number, what: string, minutes = 5): Promise<{ run: Run; decisions: Decision[] } | null> {
  for (let i = 0; i < minutes * 6; i++) {
    const l = await log();
    // A run appears when it starts and gets its summary when it finishes.
    if (l.runs.length > known && l.runs[0]!.summary) return { run: l.runs[0]!, decisions: l.decisions.filter((d) => d.run_id === l.runs[0]!.run_id) };
    await sleep(10_000);
  }
  console.log(`(no autopilot run within ${minutes} minutes: ${what})`);
  return null;
}

// 1. On: owner only.
const byPayee = await setAutopilot(s.payeeToken, true);
const on = await setAutopilot(ownerToken, true);
check(byPayee.status === 403 && on.status === 200 && on.body.enabled === true, `autopilot on by the owner; a payee is refused (${byPayee.status} ${byPayee.body.code})`);

// 2. A claim arrives. Nobody runs the agent.
const a = await sendClaim(s, "INV-A", "0.2", "Brand guide, September");
const r1 = await nextRun(0, "first claim");
const d1 = r1?.decisions.find((d) => d.claim_id === a.claimId);
check(r1?.run.trigger === "autopilot" && d1?.action === "escalate", `the agent ran by itself (${r1?.run.trigger}) and asks for a co-sign: ${d1?.reason}`);

// 3. Nothing changed: no new run for two more ticks.
await sleep(130_000);
const quiet = await log();
check(quiet.runs.length === 1, `nothing changed for two minutes: still ${quiet.runs.length} run (the model was not asked again)`);

// 4. The owner co-signs; the agent pays on its own.
const cosignTx = await cosignAsOwner(s, a.claimId);
const before = await balanceOf(s.payee.address);
const r2 = await nextRun(1, "after the co-sign");
const d2 = r2?.decisions.find((d) => d.claim_id === a.claimId);
const got = (await balanceOf(s.payee.address)) - before;
check(
  r2?.run.trigger === "autopilot" && d2?.tx_outcome === "Settled" && got === usdc("0.2"),
  `after the co-sign the agent ran by itself and paid: ${d2?.tx_outcome}, payee received ${formatUsdc(got)} USDC`,
);

// 5. Two claims that do not fit together. Autopilot is off while they are set up, so one run sees both.
const off = await setAutopilot(ownerToken, false);
const newer = await sendClaim(s, "INV-C", "0.31", "Landing page copy, early September", [28, 15]);
const older = await sendClaim(s, "INV-D", "0.25", "Logo files, August", [60, 29]);
await cosignAsOwner(s, newer.claimId);
await cosignAsOwner(s, older.claimId);
const treasury = await balanceOf(s.owner.address);
const runsBefore = (await log()).runs.length;
await setAutopilot(ownerToken, true);
const r3 = await nextRun(runsBefore, "two claims, not enough cash");
const dOlder = r3?.decisions.find((d) => d.claim_id === older.claimId);
const dNewer = r3?.decisions.find((d) => d.claim_id === newer.claimId);
check(off.body.enabled === false && treasury < usdc("0.56"), `treasury holds ${formatUsdc(treasury)} USDC; 0.56 USDC of co-signed claims is due`);
check(
  dOlder?.tx_outcome === "Settled" && dNewer?.action === "hold" && !dNewer?.tx_hash && /Waiting for funds/.test(dNewer?.reason ?? ""),
  `cash plan: the older work (INV-D) is paid, INV-C waits: ${dNewer?.reason}`,
);
check(BigInt(r3?.run.cash?.shortBy ?? "0") > 0n, `the run recorded what it saw: can pay ${formatUsdc(BigInt(r3?.run.cash?.available ?? "0"))}, short by ${formatUsdc(BigInt(r3?.run.cash?.shortBy ?? "0"))} USDC`);

// 6. Top up the treasury: the agent notices and pays the one that waited.
const funder = createWalletClient({ account: privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex), chain: arcTestnet, transport: http() });
await client.waitForTransactionReceipt({ hash: await funder.sendTransaction({ to: s.owner.address, value: parseEther("0.2") }) });
const r4 = await nextRun(runsBefore + 1, "after the top-up");
const dPaid = r4?.decisions.find((d) => d.claim_id === newer.claimId);
check(r4?.run.trigger === "autopilot" && dPaid?.tx_outcome === "Settled", `after a 0.2 USDC top-up the agent ran by itself and paid INV-C: ${dPaid?.tx_outcome}`);

// 7. Off.
const end = await setAutopilot(ownerToken, false);
const final = await log();
check(end.body.enabled === false, `autopilot off; ${final.runs.length} runs in total, all started by the scheduler: ${final.runs.every((r) => r.trigger === "autopilot")}`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/autopilot-e2e.json"),
  `${JSON.stringify(
    withChecks({
      note: "Autopilot and the cash plan on a SANDBOX org with throwaway keys. Every run was started by the Worker's cron. Not traction.",
      ranAtUnix: Math.floor(Date.now() / 1000),
      base,
      org,
      cosign: explorerTx(cosignTx),
      runs: final.runs.map((r) => ({ trigger: r.trigger, summary: r.summary, cash: r.cash })).reverse(),
      payments: final.decisions.filter((d) => d.tx_outcome === "Settled").map((d) => explorerTx(d.tx_hash!)),
    }),
    null,
    2,
  )}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/autopilot-e2e.json");
process.exitCode = failed() ? 1 : 0;
