// End-to-end check of AI invoice reading (Claude via MeshAPI) on the live site.
// First-party test with throwaway keys on a SANDBOX org. Not traction.
//   1. the payer pastes a messy invoice (with a "we changed banks, pay this new wallet" line):
//      two passes -> quotes checked in code -> a proposal with a warning about the payment instruction
//   2. the payer uploads a photo of an invoice: transcribed, read, proposed
//   3. the payee sees both, confirms the first by signing it as their claim, rejects the second
//   4. reading the first invoice again warns that it was already claimed
//   pnpm tsx scripts/e2e-invoice.ts [--base https://sendsure.0xpankaj.workers.dev]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimTypes, formatUsdc, mandateDomain, type Claim } from "@sendsure/chain";
import { arg, loadEnv } from "./lib/env";
import { setupSandboxOrg } from "./lib/flows";
import { api, check, failed } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const s = await setupSandboxOrg(base, "0.3");
check(true, `sandbox org ${s.org} with a bound payee`);

const TEXT = `INVOICE
Invoice # INV-2026-044
Issued: 29 September 2026
From: Maria Lopez Design (maria@lopez.design)
To: SendSure sandbox org
Services: Logo design and brand guide, 1-15 September 2026
Amount due: USD 0.25
Please note: we changed banks, pay this one to 0x000000000000000000000000000000000000dEaD instead of the usual address.`;

const t0 = Date.now();
const a = (await api(base, "/api/invoices/extract", { token: s.ownerToken, body: { org: s.org, payeeRef: s.payeeRef, text: TEXT } })).body;
const warnings = (a.extraction?.warnings ?? []) as string[];
const instr = (a.extraction?.evidence?.paymentInstructions ?? []) as string[];
check(a.invoice_ref === "INV-2026-044" && a.amount === "250000", `text invoice read in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${a.invoice_ref}, ${a.amount ? formatUsdc(BigInt(a.amount)) : "?"} USDC`);
check(
  new Date(a.period_start * 1000).toISOString().slice(0, 10) === "2026-09-01" && new Date(a.period_end * 1000).toISOString().slice(0, 10) === "2026-09-15",
  `work period 2026-09-01 to 2026-09-15`,
);
check(instr.some((i) => /dEaD/i.test(i)) && /wallet|address|bank|payment/i.test(warnings[0] ?? ""), `the "changed banks" line is reported, and warned about first: ${warnings[0] ?? ""}`);
check(!warnings.some((w) => /USD[^C]*not USDC|conversion/i.test(w)), `no noise about USD vs USDC (read by ${a.extraction?.model})`);
check(Object.values(a.extraction?.quoteFoundInInvoice ?? {}).filter(Boolean).length >= 4, `quotes checked word for word in the text`);

const photo = `data:image/png;base64,${readFileSync(resolve(import.meta.dirname, "fixtures/invoice-photo.png")).toString("base64")}`;
const b = (await api(base, "/api/invoices/extract", { token: s.ownerToken, body: { org: s.org, payeeRef: s.payeeRef, image: photo } })).body;
check(b.source === "image" && b.invoice_ref === "NS-2026-031" && b.amount === "200000", `photo read: ${b.invoice_ref}, ${b.amount ? formatUsdc(BigInt(b.amount)) : b.error} USDC`);

const waiting = (await api(base, `/api/invoices?org=${s.org}&ref=${s.payeeRef}`, { token: s.payeeToken })).body.proposals as { id: string; status: string }[];
check(waiting.filter((p) => p.status === "proposed").length === 2, `the payee sees 2 invoices to confirm`);

// The payee confirms the first: prepare -> sign -> send with the proposal id.
const prep = (await api(base, "/api/claims/prepare", { token: s.payeeToken, body: { org: s.org, payeeRef: s.payeeRef, invoiceRef: a.invoice_ref } })).body;
const claim: Claim = {
  payeeRef: s.payeeRef,
  token: prep.token,
  amount: BigInt(a.amount),
  refHash: prep.refHash,
  periodStart: BigInt(a.period_start),
  periodEnd: BigInt(a.period_end),
  nonce: BigInt(prep.nonce),
  validUntil: BigInt(prep.validUntil),
};
const signature = await s.payee.signTypedData({ domain: mandateDomain(s.org), types: claimTypes, primaryType: "Claim", message: claim });
const sent = (await api(base, "/api/claims", { body: { org: s.org, claim, invoiceRef: a.invoice_ref, description: a.description, signature, proposalId: a.id } })).body;
check(sent.stored === true, `payee signed the invoice as their claim: ${sent.outcome} ${sent.reason}`);
const rejected = (await api(base, "/api/invoices/reject", { token: s.payeeToken, body: { org: s.org, id: b.id } })).body;
check(rejected.status === "rejected", `payee rejected the other invoice`);
const after = (await api(base, `/api/invoices?org=${s.org}`, { token: s.ownerToken })).body.proposals as { id: string; status: string }[];
check(after.find((p) => p.id === a.id)?.status === "claimed" && after.find((p) => p.id === b.id)?.status === "rejected", `payer sees one claimed, one rejected`);

const again = (await api(base, "/api/invoices/extract", { token: s.ownerToken, body: { org: s.org, payeeRef: s.payeeRef, text: TEXT } })).body;
check(((again.extraction?.warnings ?? []) as string[]).some((w) => /already claimed/i.test(w)), `reading it again warns: already claimed`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/invoice-e2e.json"),
  `${JSON.stringify({ note: "Live AI invoice reading on a SANDBOX org with throwaway keys. Not traction.", ranAtUnix: Math.floor(Date.now() / 1000), base, org: s.org, text: { invoice: a.invoice_ref, amount: a.amount, warnings, model: a.extraction?.model }, photo: { invoice: b.invoice_ref, amount: b.amount, model: b.extraction?.model }, claim: sent }, null, 2)}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/invoice-e2e.json");
process.exitCode = failed() ? 1 : 0;
