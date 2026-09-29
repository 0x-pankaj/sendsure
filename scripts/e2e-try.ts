// End-to-end check of /try (no wallet), live: all four scenes with a fresh visitor session.
// Real transactions on the SANDBOX demo org. Not traction.
//   pnpm tsx scripts/e2e-try.ts [--base https://sendsure.0xpankaj.workers.dev]
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg } from "./lib/env";
import { api, check, failed } from "./lib/relay";

const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const session = randomUUID();
const scene = async (name: string) => (await api(base, "/api/try", { body: { session, scene: name } })).body as Record<string, any>;

const early = await scene("pay");
check(Boolean(early.error) && /scene 1/i.test(early.error), `scene order enforced (${early.error})`);
const bind = await scene("bind");
check(Boolean(bind.bindTx) && /^0x/.test(bind.payout), `1. payee bound ${bind.payout}`);
const attack = await scene("attack");
check(Boolean(attack.refusedTx), `2. attacker's claim refused on-chain ${attack.refusedTx}`);
const change = await scene("change");
check(/did not sign/.test(change.relayerSays) && change.contractSays === "BadSignature", `3. wallet change refused (${change.relayerSays} / ${change.contractSays})`);
const pay = await scene("pay");
check(/^escalate/.test(pay.firstRun) && /^pay/.test(pay.secondRun) && Boolean(pay.settleTx), `4. escalated, co-signed, paid ${pay.settleTx}`);
const inbox = await scene("inbox");
const inboxClaims = (inbox.claims ?? []) as { what: string; agent: string; paid: boolean }[];
check(
  inboxClaims.length === 3 && inboxClaims.every((c) => !c.paid && !/^pay:/.test(c.agent)),
  `5. inbox: none of the 3 tricky claims paid (${inbox.planner})`,
);
for (const c of inboxClaims) console.log(`      ${c.what}: ${c.agent}`);
const again = await scene("pay");
check(again.replayed === true && again.settleTx === pay.settleTx, `a refresh does not pay twice`);
const receipt = pay.receipt ? (await api(base, `/api/receipt?tx=${String(pay.receipt).split("tx=")[1]}`)).body : {};
check(receipt.amountUsdc === "0.05" && receipt.tier === "sandbox" && Boolean(receipt.addressProof), `receipt: ${receipt.amountUsdc} USDC, ${receipt.tier}, address proof found`);
const lookup = (await api(base, `/api/lookup?org=${receipt.org}&address=${bind.payout}`)).body;
check(lookup.verified === true, `lookup: the payee's address is verified for the demo org`);
const lookalike = (await api(base, `/api/lookup?org=${receipt.org}&address=${attack.attacker}`)).body;
check(lookalike.verified === false, `lookup: the attacker's address is not`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/try-e2e.json"),
  `${JSON.stringify({ note: "Live /try walkthrough on the SANDBOX demo org. Not traction.", ranAtUnix: Math.floor(Date.now() / 1000), base, bind, attack, change, pay, inbox }, null, 2)}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/try-e2e.json");
process.exitCode = failed() ? 1 : 0;
