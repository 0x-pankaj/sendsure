// End-to-end check: a real Odoo 19 (Docker, with the sendsure_payables add-on) pays a vendor bill through
// the live SendSure on Arc testnet, and records the payment back exactly.
// First-party test with throwaway keys on a SANDBOX org. Not traction.
//   1. the org's owner creates an integration key; Odoo connects with it and sets up USDC + the journal
//   2. an "AP agent" user (Invoicing role only) links the vendor to their SendSure invite: Odoo reads the
//      proven address from SendSure and adds it as an untrusted wallet
//   3. a wallet someone slipped onto the vendor cannot be trusted, even by the admin; the agent user can't trust at all
//   4. a bill can't be sent until a person trusts the proven wallet; then "Pay with SendSure" (idempotent)
//   5. the vendor signs it (a different amount is refused); Odoo's cron asks the agent to run: first payment,
//      so it waits for a co-sign; the owner co-signs on-chain; the next cron run pays it on Arc
//   6. Odoo records it through Register Payment: exact amount, USDC journal, the Arc tx in the memo, once
//   Needs Odoo from integrations/odoo (./run.sh up) on http://127.0.0.1:18069, admin / admin.
//   pnpm tsx scripts/e2e-odoo.ts [--base https://sendsure.0xpankaj.workers.dev] [--odoo http://127.0.0.1:18069]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { erc20Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { claimTypes, deployment, explorerTx, formatUsdc, mandateDomain, usdc, type Claim } from "@sendsure/chain";
import { arg, loadEnv } from "./lib/env";
import { client, cosignAsOwner, setupSandboxOrg, type SandboxOrg } from "./lib/flows";
import { api, check, failed } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const odooUrl = arg("odoo", "http://127.0.0.1:18069")!;
const DB = "sendsure";
const run = Date.now().toString(36);

// ------------------------------------------------------------------ Odoo over JSON-RPC

async function rpc(service: string, method: string, args: unknown[]) {
  const res = await fetch(`${odooUrl}/jsonrpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: 1 }),
  });
  const out = (await res.json()) as { result?: unknown; error?: { data?: { message?: string }; message?: string } };
  if (out.error) throw new Error(out.error.data?.message ?? out.error.message ?? "Odoo error");
  return out.result as any;
}

function session(uid: number, password: string) {
  return (model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
    rpc("object", "execute_kw", [DB, uid, password, model, method, args, kwargs]);
}
type Session = ReturnType<typeof session>;

/** The Odoo error text if the call is refused, or null if it went through. */
async function refused(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (err) {
    return String((err as Error).message);
  }
}

async function waitForOdoo() {
  for (let i = 0; i < 90; i++) {
    try {
      const v = await rpc("common", "version", []);
      const uid = await rpc("common", "login", [DB, "admin", "admin"]);
      if (uid) return v.server_version as string;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Odoo is not up at ${odooUrl} (run integrations/odoo/run.sh up)`);
}

// ------------------------------------------------------------------ the payee signs a bill in SendSure

async function signProposal(s: SandboxOrg, p: { id: string; invoice_ref: string; period_start: number; period_end: number }, amount: bigint) {
  const prep = (
    await api(base, "/api/claims/prepare", { token: s.payeeToken, body: { org: s.org, payeeRef: s.payeeRef, invoiceRef: p.invoice_ref } })
  ).body;
  const claim: Claim = {
    payeeRef: s.payeeRef,
    token: prep.token,
    amount,
    refHash: prep.refHash,
    periodStart: BigInt(p.period_start),
    periodEnd: BigInt(p.period_end),
    nonce: BigInt(prep.nonce),
    validUntil: BigInt(prep.validUntil),
  };
  const signature = await s.payee.signTypedData({ domain: mandateDomain(s.org), types: claimTypes, primaryType: "Claim", message: claim });
  return api(base, "/api/claims", {
    body: { org: s.org, claim, invoiceRef: p.invoice_ref, description: "Logo and brand guide", signature, proposalId: p.id },
  });
}

// ------------------------------------------------------------------ run

const version = await waitForOdoo();
const adminUid = await rpc("common", "login", [DB, "admin", "admin"]);
const admin = session(adminUid, "admin");
check(true, `Odoo ${version} with sendsure_payables at ${odooUrl}`);

// 1. SendSure org + key; Odoo connects
const s = await setupSandboxOrg(base, "0.5");
check(true, `sandbox org ${s.org} with a payee who proved ${s.payee.address}`);
const created = await api(base, "/api/org/keys", { token: s.ownerToken, body: { org: s.org, label: "Odoo e2e" } });
const key = created.body.key as string;
check(created.status === 200 && key?.startsWith("ssk_"), `owner created an integration key (shown once, stored as a hash)`);
const stranger = await api(base, "/api/org/keys", { token: s.payeeToken, body: { org: s.org } });
check(stranger.status === 403, `a payee cannot create a key for the org (${stranger.status})`);

await admin("ir.config_parameter", "set_param", ["sendsure.url", base]);
await admin("ir.config_parameter", "set_param", ["sendsure.api_key", key]);
const [settingsId] = [await admin("res.config.settings", "create", [{}])];
await admin("res.config.settings", "action_sendsure_test", [[settingsId]]);
const connectedOrg = await admin("ir.config_parameter", "get_param", ["sendsure.org"]);
check(connectedOrg?.toLowerCase() === s.org.toLowerCase(), `Odoo connected to org ${connectedOrg}`);
const [usc] = await admin("res.currency", "search_read", [[["name", "=", "USC"]]], { fields: ["symbol", "rounding", "decimal_places"] });
const [company] = await admin("res.company", "search_read", [[["id", "=", 1]]], { fields: ["sendsure_journal_id"] });
check(usc?.symbol === "USDC" && usc?.decimal_places === 6 && Boolean(company.sendsure_journal_id), `USDC (USC, 6 decimals) and journal "${company.sendsure_journal_id?.[1]}" set up`);

// An AP agent user: Invoicing role and contact creation only (can add vendors, create and post bills;
// cannot trust bank accounts).
const groupUser = (await admin("ir.model.data", "check_object_reference", ["base", "group_user"]))[1];
const groupInvoice = (await admin("ir.model.data", "check_object_reference", ["account", "group_account_invoice"]))[1];
const groupContacts = (await admin("ir.model.data", "check_object_reference", ["base", "group_partner_manager"]))[1];
const agentPassword = `pw-${generatePrivateKey().slice(2, 18)}`;
const agentUid = await admin("res.users", "create", [
  { name: `AP Agent ${run}`, login: `ap-agent-${run}`, password: agentPassword, group_ids: [[6, 0, [groupUser, groupInvoice, groupContacts]]] },
]);
const agent: Session = session(agentUid, agentPassword);

// 2. The vendor, linked to their SendSure invite
const invite = `${base}/verify?org=${s.org}&ref=${s.payeeRef}&name=Sandbox`;
const vendor = await agent("res.partner", "create", [{ name: `Maria Lopez Design ${run}`, is_company: true, sendsure_payee_ref: invite }]);
await agent("res.partner", "action_sendsure_refresh", [[vendor]]);
const [v] = await admin("res.partner", "read", [[vendor]], { fields: ["sendsure_state", "sendsure_address", "sendsure_payee_ref"] });
check(v.sendsure_state === "bound" && v.sendsure_address?.toLowerCase() === s.payee.address.toLowerCase(), `vendor linked by invite link: ${v.sendsure_state}, proven ${v.sendsure_address}`);
const banks = async () =>
  (await admin("res.partner.bank", "search_read", [[["partner_id", "=", vendor]]], { fields: ["acc_number", "allow_out_payment"] })) as {
    id: number;
    acc_number: string;
    allow_out_payment: boolean;
  }[];
const proven = (await banks()).find((b) => b.acc_number.toLowerCase() === s.payee.address.toLowerCase());
check(Boolean(proven) && !proven!.allow_out_payment, `the proven wallet was added to the vendor, untrusted`);

// 3. A slipped-in wallet can't be trusted; the agent user can't trust anything
const attacker = privateKeyToAccount(generatePrivateKey()).address;
const attackerBank = await agent("res.partner.bank", "create", [{ partner_id: vendor, acc_number: attacker }]);
const adminTrustAttacker = await refused(admin("res.partner.bank", "write", [[attackerBank], { allow_out_payment: true }]));
check(/not the address/.test(adminTrustAttacker ?? ""), `even the admin cannot trust a wallet the vendor did not prove: "${adminTrustAttacker?.slice(0, 90)}…"`);
const agentTrust = await refused(agent("res.partner.bank", "write", [[proven!.id], { allow_out_payment: true }]));
check(/rights/.test(agentTrust ?? ""), `the AP agent user cannot trust a wallet (Odoo's own rule)`);

// 4. The bill
const invoiceRef = `INV-ODOO-${run}`.toUpperCase();
const bill = await agent("account.move", "create", [
  {
    move_type: "in_invoice",
    partner_id: vendor,
    invoice_date: new Date().toISOString().slice(0, 10),
    ref: invoiceRef,
    currency_id: (await admin("ir.model.data", "check_object_reference", ["base", "USD"]))[1],
    invoice_line_ids: [[0, 0, { name: "Logo and brand guide", quantity: 1, price_unit: 0.25, tax_ids: [[6, 0, []]] }]],
  },
]);
await agent("account.move", "action_post", [[bill]]);
const early = await refused(agent("account.move", "action_sendsure_send", [[bill]]));
check(/Trust/.test(early ?? ""), `"Pay with SendSure" waits until a person trusts the proven wallet`);
await admin("res.partner.bank", "write", [[proven!.id], { allow_out_payment: true }]);
await agent("account.move", "action_sendsure_send", [[bill]]);
await agent("account.move", "action_sendsure_send", [[bill]]); // again: idempotent
const readBill = async () =>
  (
    await admin("account.move", "read", [[bill]], {
      fields: ["name", "sendsure_state", "sendsure_reason", "sendsure_tx", "sendsure_amount_paid", "payment_state", "amount_residual", "sendsure_external_id"],
    })
  )[0];
let b = await readBill();
check(b.sendsure_state === "waiting_for_payee", `bill ${b.name} sent by the AP agent user: ${b.sendsure_state}`);
const proposals = (await api(base, `/api/invoices?org=${s.org}&ref=${s.payeeRef}`, { token: s.payeeToken })).body.proposals as any[];
const mine = proposals.filter((p) => p.source === "odoo" && p.invoice_ref === invoiceRef);
check(mine.length === 1 && mine[0].amount === "250000", `the vendor sees it once in SendSure, from Odoo: ${invoiceRef}, ${formatUsdc(BigInt(mine[0]?.amount ?? 0))} USDC`);

// 5. The vendor signs; the cron runs the agent; co-sign; paid
const wrong = await signProposal(s, mine[0], usdc("0.26"));
check(wrong.status === 409 && wrong.body.code === "PROPOSAL_MISMATCH", `a claim for a different amount than the bill is refused (${wrong.body.code})`);
const signed = await signProposal(s, mine[0], BigInt(mine[0].amount));
check(signed.status === 200 && signed.body.outcome === "ESCALATED", `the vendor signed the bill: ${signed.body.outcome} (first payment needs a co-sign)`);

const cron = (await admin("ir.model.data", "check_object_reference", ["sendsure_payables", "ir_cron_sendsure_sync"]))[1];
await admin("ir.cron", "method_direct_trigger", [[cron]]);
b = await readBill();
check(b.sendsure_state === "needs_cosign", `Odoo's cron asked the agent to run: ${b.sendsure_state} (${b.sendsure_reason})`);

const cosignTx = await cosignAsOwner(s, signed.body.claimId as Hex);
check(true, `the owner co-signed on-chain: ${explorerTx(cosignTx)}`);
const before = await client.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [s.payee.address] });
await admin("ir.cron", "method_direct_trigger", [[cron]]);
b = await readBill();
const after = await client.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [s.payee.address] });
check(b.sendsure_state === "paid" && Boolean(b.sendsure_tx), `the next cron run: the agent paid it on Arc, ${explorerTx(b.sendsure_tx)}`);
check(after - before === usdc("0.25"), `the vendor's proven address received ${formatUsdc(after - before)} USDC`);

// 6. Recorded in Odoo, exactly, once
const payments = (await admin("account.payment", "search_read", [[["sendsure_tx", "=", b.sendsure_tx]]], {
  fields: ["name", "amount", "currency_id", "journal_id", "memo", "partner_bank_id", "state"],
})) as any[];
const p = payments[0];
check(payments.length === 1 && p.amount === 0.25 && p.currency_id[1] === "USC" && p.memo.includes(b.sendsure_tx), `recorded through Register Payment: ${p?.name}, ${p?.amount} ${p?.currency_id?.[1]}, memo "${p?.memo?.slice(0, 20)}…"`);
check(p?.partner_bank_id?.[1]?.toLowerCase().includes(s.payee.address.slice(2, 10).toLowerCase()) && p?.journal_id?.[0] === company.sendsure_journal_id[0], `to the proven wallet, from the SendSure journal`);
check(["paid", "in_payment"].includes(b.payment_state) && b.amount_residual === 0 && b.sendsure_amount_paid === "0.250000", `bill ${b.payment_state}, 0.00 left open, paid exactly ${b.sendsure_amount_paid} USDC`);
await admin("ir.cron", "method_direct_trigger", [[cron]]);
await agent("account.move", "action_sendsure_refresh", [[bill]]);
const again = await admin("account.payment", "search_count", [[["sendsure_tx", "=", b.sendsure_tx]]]);
check(again === 1, `syncing again records nothing twice`);
const line = (await admin("account.payment.method.line", "search_read", [[["journal_id", "=", company.sendsure_journal_id[0]], ["code", "=", "sendsure_usdc"]]], { fields: ["id"] }))[0];
const manualPay = await admin("account.payment", "create", [
  { payment_type: "outbound", partner_type: "supplier", partner_id: vendor, amount: 1, journal_id: company.sendsure_journal_id[0], payment_method_line_id: line.id, partner_bank_id: proven!.id },
]);
const manual = await refused(admin("account.payment", "action_post", [[manualPay]]));
check(/recorded by SendSure/.test(manual ?? ""), `a hand-made USDC payment in the SendSure journal is refused: nothing is recorded without an Arc tx`);
const bills = (await api(base, `/api/v1/bills?ids=${encodeURIComponent(b.sendsure_external_id)}`, { token: key })).body.bills as any[];
check(bills?.[0]?.settlement?.amount === "250000" && bills[0].settlement.payout === s.payee.address, `SendSure's view matches: Settled event carries 250000 (0.25 USDC) to ${s.payee.address}`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/odoo-e2e.json"),
  `${JSON.stringify(
    {
      note: "First-party end-to-end test: Odoo 19 Community (Docker) with the sendsure_payables add-on, against the live SendSure, SANDBOX org with throwaway keys. Not traction.",
      ranAtUnix: Math.floor(Date.now() / 1000),
      base,
      odoo: version,
      org: s.org,
      payee: s.payee.address,
      bill: { name: b.name, invoiceRef, amountUsd: "0.25", state: b.payment_state, sendsure: b.sendsure_state },
      refused: { trustSlippedInWallet: adminTrustAttacker, agentUserTrust: agentTrust, sendBeforeTrust: early, wrongAmountClaim: wrong.body.code, manualUsdcPayment: manual },
      cosign: explorerTx(cosignTx),
      settle: explorerTx(b.sendsure_tx),
      odooPayment: { name: p?.name, amount: p?.amount, currency: p?.currency_id?.[1], journal: p?.journal_id?.[1], memo: p?.memo },
      settlement: bills?.[0]?.settlement,
    },
    null,
    2,
  )}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/odoo-e2e.json");
process.exitCode = failed() ? 1 : 0;
