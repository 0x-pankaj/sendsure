// The evidence folder for the submission (PLAN S3): every counted org, proven payee, payment, co-sign and anchored
// decision-log head from the live dashboard, each with its Arc transaction, written to deployments/evidence/.
// Run it at the freeze, and whenever the numbers change:
//   pnpm evidence [--base https://sendsure.0xpankaj.workers.dev]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg } from "./lib/env";

const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const res = await fetch(`${base}/api/stats/evidence`);
if (!res.ok) throw new Error(`evidence: ${res.status} ${await res.text()}`);
const ev = (await res.json()) as {
  totals: Record<string, { orgs: number; payeesBound: number; payments: number; paidUsdc: string }>;
  tiers: Record<string, { orgs: unknown[]; payeesBound: unknown[]; payments: { amountUsdc: string; tx: string; receipt: string }[]; cosigns: unknown[]; anchors: unknown[] }>;
};
const dir = resolve(import.meta.dirname, "../deployments/evidence");
mkdirSync(dir, { recursive: true });
const at = new Date().toISOString();
writeFileSync(resolve(dir, "traction.json"), `${JSON.stringify({ exportedAt: at, source: `${base}/api/stats/evidence`, ...ev }, null, 2)}\n`);

const row = (tier: string) => {
  const t = ev.tiers[tier];
  return t
    ? `| ${tier} | ${t.orgs.length} | ${t.payeesBound.length} | ${t.payments.length} | ${t.cosigns.length} | ${t.anchors.length} |`
    : `| ${tier} | counted only: ${ev.totals[tier]?.orgs ?? 0} orgs, ${ev.totals[tier]?.payments ?? 0} payments | | | | |`;
};
const payments = (tier: string) =>
  ev.tiers[tier]!.payments.map((p) => `- ${p.amountUsdc} USDC: [receipt](${p.receipt}), [tx](https://explorer.testnet.arc.io/tx/${p.tx})`).join("\n") || "- none yet";
writeFileSync(
  resolve(dir, "README.md"),
  `# Evidence (exported ${at.slice(0, 16).replace("T", " ")} UTC)

Every number on [/dashboard](${base}/dashboard), listed with its Arc testnet transaction in
[traction.json](traction.json). Counted from SendSure's contracts' events, in three tiers:
**external** (owner is not one of our wallets: the only tier that counts as traction), **first-party**
(our own wallets, listed in the file) and **sandbox** (our tests: counted, never listed or claimed).
Each payment's receipt shows the payee's proof, the signed claim, the agent's decision and the
decision-log head anchored on Arc. The database is Cloudflare D1, whose Time Travel keeps 30 days of
point-in-time restores. Re-export with \`pnpm evidence\`.

| Tier | Orgs | Payees who proved their address | Payments | Co-signs | Anchored log heads |
|---|---|---|---|---|---|
${row("external")}
${row("first-party")}
${row("sandbox")}

## Payments by outside teams

${payments("external")}

## Payments from our own wallets (first-party, not traction)

${payments("first-party")}
`,
);
console.log(`written deployments/evidence/ (external: ${ev.tiers.external?.payments.length ?? 0} payments, first-party: ${ev.tiers["first-party"]?.payments.length ?? 0})`);
