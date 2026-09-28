// Runs the SendSure agent for one org with the Circle agent wallet as the executor (Circle Agent Stack):
// the server plans and logs every decision; this machine's Circle CLI sends settle() and anchor() from
// the Circle agent wallet; the server records each tx only after reading it from the chain.
//   pnpm agent:circle --org 0x… [--base https://sendsure.0xpankaj.workers.dev]
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { SENDSURE_AGENTS, explorerTx } from "@sendsure/chain";
import { signInMessage } from "../apps/web/lib/signin";
import { arg, loadEnv } from "./lib/env";
import { api } from "./lib/relay";

/** Checksummed: the sign-in text must match the server's, character for character. */
export const CIRCLE_AGENT = getAddress(SENDSURE_AGENTS.circleAgentWallet);

function circle(args: string[]): string {
  const r = spawnSync("circle", args, { encoding: "utf8", timeout: 180_000 });
  if (r.status !== 0)
    throw new Error(`circle ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout.trim();
}

/** Sign in to SendSure as the Circle agent wallet (a smart account: the server checks ERC-1271). */
export async function signInAsCircleAgent(base: string): Promise<string> {
  const issuedAt = new Date().toISOString();
  const nonce = randomUUID().replace(/-/g, "");
  const message = signInMessage(CIRCLE_AGENT, issuedAt, nonce);
  const signature = circle(["wallet", "sign", "message", message, "--address", CIRCLE_AGENT, "--chain", "ARC-TESTNET", "--quiet"])
    .split("\n")
    .pop()!;
  const r = await api(base, "/api/session", { body: { address: CIRCLE_AGENT, issuedAt, nonce, signature } });
  if (r.status !== 200) throw new Error(`Circle agent sign-in failed: ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

/** `circle wallet execute`: the Circle agent wallet sends one contract call and waits for it. */
export function circleExecute(contract: Address, fn: string, args: string[]): Hex {
  const out = circle([
    "wallet",
    "execute",
    fn,
    ...args,
    "--contract",
    contract,
    "--address",
    CIRCLE_AGENT,
    "--chain",
    "ARC-TESTNET",
    "--idempotency-key",
    randomUUID(),
    "--output",
    "json",
  ]);
  const data = JSON.parse(out).data as { state?: string; txHash?: Hex };
  if (data.state !== "COMPLETE" || !data.txHash) throw new Error(`Circle execute not complete: ${JSON.stringify(data)}`);
  return data.txHash;
}

export async function runWithCircle(base: string, org: Address, token: string) {
  const plan = await api(base, "/api/agent/run", { token, body: { org, execute: false } });
  if (plan.status !== 200) throw new Error(`plan failed: ${JSON.stringify(plan.body)}`);
  const executions: { seq: number; invoice: string; txHash: Hex; outcome: string }[] = [];
  for (const d of plan.body.decisions as {
    seq: number;
    action: string;
    invoiceRef: string;
    decisionHash: Hex;
    settle?: { claimHex: Hex; payeeSig: Hex };
  }[]) {
    if (d.action !== "pay" || !d.settle) continue;
    const txHash = circleExecute(org, "settle(bytes,bytes,bytes32)", [d.settle.claimHex, d.settle.payeeSig, d.decisionHash]);
    const rec = await api(base, "/api/agent/executed", { token, body: { org, seq: d.seq, txHash } });
    executions.push({ seq: d.seq, invoice: d.invoiceRef, txHash, outcome: rec.body.outcome ?? rec.body.error });
  }
  let anchor: { anchorSeq: number; txHash: Hex } | null = null;
  const a = await api(base, `/api/agent/anchor?org=${org}`, { token });
  if (a.body.plan) {
    const txHash = circleExecute(org, "anchor(bytes32,uint64)", [a.body.plan.head, String(a.body.plan.anchorSeq)]);
    const rec = await api(base, "/api/agent/anchor", { token, body: { org, txHash } });
    anchor = { anchorSeq: rec.body.anchorSeq, txHash };
  }
  return {
    plan: plan.body as {
      planner: string;
      summary: string;
      decisions: { seq: number; action: string; reason: string; invoiceRef: string; decisionHash: Hex }[];
    },
    executions,
    anchor,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
  const org = arg("org") as Address;
  if (!org) throw new Error("--org is required");
  const token = await signInAsCircleAgent(base);
  const out = await runWithCircle(base, org, token);
  console.log(out.plan.summary, `(${out.plan.planner})`);
  for (const d of out.plan.decisions) console.log(`  #${d.seq} ${d.invoiceRef}: ${d.action} (${d.reason})`);
  for (const e of out.executions)
    console.log(`  settled by the Circle agent wallet: ${e.invoice} ${e.outcome} ${explorerTx(e.txHash)}`);
  if (out.anchor) console.log(`  anchored #${out.anchor.anchorSeq}: ${explorerTx(out.anchor.txHash)}`);
}
