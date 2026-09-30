// End-to-end check: a real ERPNext 15 (Docker, with the sendsure_erpnext app) pays a purchase invoice through
// the live SendSure on Arc testnet, and records the payment back exactly.
// First-party test with throwaway keys on a SANDBOX org. Not traction.
//   1. the org's owner creates an integration key; ERPNext connects with it and sets up USDC + its account
//   2. an "AP clerk" user (no Accounts Manager role) links the supplier to their SendSure invite: ERPNext reads
//      the proven address from SendSure
//   3. nobody can type another address onto the supplier, not even the administrator; the clerk cannot approve
//   4. an invoice can't be sent until an Accounts Manager approves the proven address; then "Pay with SendSure" (idempotent)
//   5. the supplier signs it (a different amount is refused); ERPNext's scheduled job asks the agent to run: first
//      payment, so it waits for a co-sign; the owner co-signs on-chain; the next run of the job pays it on Arc
//   6. ERPNext records it as a Payment Entry: exact amount, USDC account, the Arc tx as its reference, once
//   Needs ERPNext from integrations/erpnext (./run.sh up) on http://127.0.0.1:18080, Administrator / admin.
//   pnpm tsx scripts/e2e-erpnext.ts [--base https://sendsure.0xpankaj.workers.dev] [--erpnext http://127.0.0.1:18080]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { erc20Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { claimTypes, deployment, explorerTx, formatUsdc, mandateDomain, usdc, type Claim } from "@sendsure/chain";
import { arg, loadEnv } from "./lib/env";
import { client, cosignAsOwner, setupSandboxOrg, type SandboxOrg } from "./lib/flows";
import { api, check, failed, withChecks } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const erpUrl = arg("erpnext", "http://127.0.0.1:18080")!;
const run = Date.now().toString(36);
const MODE = "USDC on Arc (SendSure)";
const JOB = "sync.run"; // the Scheduled Job Type for sendsure_erpnext.sync.run (cron */5 * * * *)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ ERPNext over its REST API

class ErpError extends Error {}

/** What ERPNext showed the user, from a refused call. */
function errorText(body: any): string {
  try {
    const messages = JSON.parse(body._server_messages ?? "[]") as string[];
    const text = messages.map((m) => JSON.parse(m).message as string).join(" ");
    if (text) return text.replace(/<[^>]+>/g, "");
  } catch {
    // fall through to the exception text
  }
  return String(body.exception ?? body.exc_type ?? body.message ?? "ERPNext error");
}

async function login(usr: string, pwd: string) {
  const res = await fetch(`${erpUrl}/api/method/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ usr, pwd }),
  });
  const sid = res.headers.getSetCookie().find((c) => c.startsWith("sid="))?.split(";")[0];
  if (res.status !== 200 || !sid || sid === "sid=Guest") throw new ErpError(`ERPNext login failed for ${usr} (${res.status})`);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${erpUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json", cookie: sid },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await r.json().catch(() => ({}))) as any;
    if (r.status >= 400) throw new ErpError(errorText(out));
    return out;
  };
  const q = (v: unknown) => encodeURIComponent(JSON.stringify(v));
  return {
    /** A whitelisted method. */
    method: async (name: string, args: Record<string, unknown> = {}) => (await call("POST", `/api/method/${name}`, args)).message,
    create: async (doctype: string, doc: Record<string, unknown>) => (await call("POST", `/api/resource/${encodeURIComponent(doctype)}`, doc)).data,
    update: async (doctype: string, name: string, doc: Record<string, unknown>) =>
      (await call("PUT", `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`, doc)).data,
    get: async (doctype: string, name: string) =>
      (await call("GET", `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)).data,
    list: async (doctype: string, filters: unknown[], fields: string[], orderBy = "creation desc") =>
      (
        await call(
          "GET",
          `/api/resource/${encodeURIComponent(doctype)}?filters=${q(filters)}&fields=${q(fields)}&order_by=${encodeURIComponent(orderBy)}&limit_page_length=20`,
        )
      ).data as any[],
  };
}
type Session = Awaited<ReturnType<typeof login>>;

/** ERPNext's message if the call is refused, or null if it went through. */
async function refused(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
    return null;
  } catch (err) {
    if (!(err instanceof ErpError)) throw err;
    return err.message;
  }
}

async function waitForErpnext() {
  for (let i = 0; i < 120; i++) {
    try {
      const s = await login("Administrator", "admin");
      const v = await s.method("frappe.utils.change_log.get_versions");
      if (v?.sendsure_erpnext) return { admin: s, versions: v as Record<string, { version: string }> };
    } catch {
      // still starting
    }
    await sleep(5000);
  }
  throw new Error(`ERPNext is not up at ${erpUrl} (run integrations/erpnext/run.sh up)`);
}

/** Run ERPNext's own scheduled job now (the scheduler runs it every 5 minutes), and wait until it has finished. */
async function runScheduledJob(admin: Session) {
  const logs = () => admin.list("Scheduled Job Log", [["scheduled_job_type", "=", JOB]], ["name", "status"]);
  for (let attempt = 0; attempt < 6; attempt++) {
    const earlier = new Set((await logs()).map((l) => l.name)); // runs that started before we asked
    await admin.method("frappe.core.doctype.scheduled_job_type.scheduled_job_type.execute_event", { doc: JSON.stringify({ name: JOB }) });
    // An agent run reviews each claim with Claude and settles on Arc: allow it a few minutes.
    for (let i = 0; i < 120; i++) {
      await sleep(3000);
      const mine = (await logs()).filter((l) => !earlier.has(l.name));
      if (mine.some((l) => l.status === "Failed")) throw new Error(`ERPNext's scheduled job ${JOB} failed (see Scheduled Job Log)`);
      if (mine.some((l) => l.status === "Complete")) return;
      // The scheduler's own run was already going, so ours was not queued: once that one is done, ask again.
      if (mine.length === 0 && i >= 10) break;
    }
  }
  throw new Error(`ERPNext's scheduled job ${JOB} did not finish`);
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

const { admin, versions } = await waitForErpnext();
const version = `${versions.erpnext?.version} (Frappe ${versions.frappe?.version}, sendsure_erpnext ${versions.sendsure_erpnext?.version})`;
check(Boolean(versions.erpnext?.version?.startsWith("15.")), `ERPNext ${version} at ${erpUrl}`);

// 1. SendSure org + key; ERPNext connects
const s = await setupSandboxOrg(base, "0.5");
check(true, `sandbox org ${s.org} with a payee who proved ${s.payee.address}`);
const created = await api(base, "/api/org/keys", { token: s.ownerToken, body: { org: s.org, label: "ERPNext e2e" } });
const key = created.body.key as string;
check(created.status === 200 && key?.startsWith("ssk_"), `owner created an integration key (shown once, stored as a hash)`);
const stranger = await api(base, "/api/org/keys", { token: s.payeeToken, body: { org: s.org } });
check(stranger.status === 403, `a payee cannot create a key for the org (${stranger.status})`);

await admin.update("SendSure Settings", "SendSure Settings", { url: base, api_key: key });
const connected = await admin.method("sendsure_erpnext.sendsure.doctype.sendsure_settings.sendsure_settings.test_connection");
const settings = await admin.get("SendSure Settings", "SendSure Settings");
check(settings.org?.toLowerCase() === s.org.toLowerCase() && settings.org_tier === "sandbox", `ERPNext connected to org ${settings.org} (${settings.org_tier})`);
check(!String(settings.api_key ?? "").startsWith("ssk_"), `the key is stored as a Password field: reading the settings back shows "${settings.api_key}"`);
const usdcCurrency = await admin.get("Currency", "USDC");
const [company] = await admin.list("Company", [["default_currency", "=", "USD"]], ["name", "default_payable_account"]);
const [usdcAccount] = await admin.list("Account", [["account_name", "=", MODE], ["company", "=", company.name]], ["name", "account_currency", "account_type"]);
check(
  usdcCurrency.enabled === 1 && usdcCurrency.fraction_units === 1000000 && usdcAccount?.account_currency === "USDC" && connected.accounts.includes(usdcAccount.name),
  `USDC (1 USDC = 1,000,000 units) and the account "${usdcAccount?.name}" (${usdcAccount?.account_type}, in ${usdcAccount?.account_currency}) set up`,
);

// An AP clerk: can add suppliers, create and submit purchase invoices; is not an Accounts Manager.
const clerkPassword = `pw-${generatePrivateKey().slice(2, 26)}`;
const clerkEmail = `ap-clerk-${run}@sendsure.example`;
await admin.create("User", {
  email: clerkEmail,
  first_name: `AP Clerk ${run}`,
  send_welcome_email: 0,
  new_password: clerkPassword,
  roles: ["Accounts User", "Purchase User", "Purchase Manager", "Purchase Master Manager"].map((role) => ({ role })),
});
const clerk = await login(clerkEmail, clerkPassword);

// 2. The supplier, linked to their SendSure invite
const invite = `${base}/verify?org=${s.org}&ref=${s.payeeRef}&name=Sandbox`;
const supplier = (await clerk.create("Supplier", { supplier_name: `Maria Lopez Design ${run}`, supplier_group: "Services", sendsure_invite: invite })).name as string;
await clerk.method("sendsure_erpnext.supplier.check", { supplier });
let v = await admin.get("Supplier", supplier);
check(
  v.sendsure_invite === s.payeeRef.toLowerCase() && v.sendsure_state === "Proved their address" && v.sendsure_address?.toLowerCase() === s.payee.address.toLowerCase(),
  `supplier linked by invite link: "${v.sendsure_state}", proven ${v.sendsure_address}`,
);
check(v.sendsure_trusted === 0, `the proven address is on the supplier, not yet approved for payments`);

// 3. No other address can be put on the supplier; the clerk cannot approve
const attacker = privateKeyToAccount(generatePrivateKey()).address;
const clerkTyped = await refused(clerk.update("Supplier", supplier, { sendsure_address: attacker }));
const adminTyped = await refused(admin.update("Supplier", supplier, { sendsure_address: attacker, sendsure_trusted: 1 }));
check(/cannot be typed in/.test(clerkTyped ?? "") && /cannot be typed in/.test(adminTyped ?? ""), `nobody can type another address onto the supplier, not even the administrator: "${adminTyped?.slice(0, 90)}…"`);
const clerkApprove = await refused(clerk.method("sendsure_erpnext.supplier.approve", { supplier }));
check(/Accounts Manager/.test(clerkApprove ?? ""), `the AP clerk cannot approve a payout address: "${clerkApprove}"`);
v = await admin.get("Supplier", supplier);
check(v.sendsure_address?.toLowerCase() === s.payee.address.toLowerCase() && v.sendsure_trusted === 0, `after those attempts the supplier still has only the proven address, unapproved`);

// 4. The purchase invoice
const item = "Design Services";
if ((await admin.list("Item", [["name", "=", item]], ["name"])).length === 0)
  await admin.create("Item", { item_code: item, item_group: "Services", is_stock_item: 0, stock_uom: "Nos" });
const invoiceRef = `INV-ERPNEXT-${run}`.toUpperCase();
const today = new Date().toISOString().slice(0, 10);
const bill = (
  await clerk.create("Purchase Invoice", {
    supplier,
    company: company.name,
    bill_no: invoiceRef,
    bill_date: today,
    currency: "USD",
    items: [{ item_code: item, item_name: "Logo and brand guide", qty: 1, rate: 0.25 }],
    docstatus: 1,
  })
).name as string;
const early = await refused(clerk.method("sendsure_erpnext.purchase_invoice.pay_with_sendsure", { invoice: bill }));
check(/Approve/.test(early ?? ""), `"Pay with SendSure" waits until an Accounts Manager approves the proven address`);
await admin.method("sendsure_erpnext.supplier.approve", { supplier });
await clerk.method("sendsure_erpnext.purchase_invoice.pay_with_sendsure", { invoice: bill });
await clerk.method("sendsure_erpnext.purchase_invoice.pay_with_sendsure", { invoice: bill }); // again: idempotent
let b = await admin.get("Purchase Invoice", bill);
check(b.sendsure_state === "Waiting for the supplier to sign" && b.sendsure_external_id?.startsWith("erpnext:"), `invoice ${b.name} sent by the AP clerk: "${b.sendsure_state}"`);
const proposals = (await api(base, `/api/invoices?org=${s.org}&ref=${s.payeeRef}`, { token: s.payeeToken })).body.proposals as any[];
const mine = proposals.filter((p) => p.invoice_ref === invoiceRef);
check(mine.length === 1 && mine[0].amount === "250000", `the supplier sees it once in SendSure: ${invoiceRef}, ${formatUsdc(BigInt(mine[0]?.amount ?? 0))} USDC`);

// 5. The supplier signs; the scheduled job runs the agent; co-sign; paid
const wrong = await signProposal(s, mine[0], usdc("0.26"));
check(wrong.status === 409 && wrong.body.code === "PROPOSAL_MISMATCH", `a claim for a different amount than the invoice is refused (${wrong.body.code})`);
const signed = await signProposal(s, mine[0], BigInt(mine[0].amount));
check(signed.status === 200 && signed.body.outcome === "ESCALATED", `the supplier signed the invoice: ${signed.body.outcome} (first payment needs a co-sign)`);

const [job] = await admin.list("Scheduled Job Type", [["name", "=", JOB]], ["method", "frequency", "cron_format", "stopped"]);
check(job?.method === "sendsure_erpnext.sync.run" && job.cron_format === "*/5 * * * *" && job.stopped === 0, `ERPNext's scheduler runs ${job?.method} on "${job?.cron_format}"`);
await runScheduledJob(admin);
b = await admin.get("Purchase Invoice", bill);
check(b.sendsure_state === "Needs a co-sign in SendSure", `ERPNext's scheduled job asked the agent to run: "${b.sendsure_state}" (${b.sendsure_reason})`);

const before = await client.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [s.payee.address] });
const cosignTx = await cosignAsOwner(s, signed.body.claimId as Hex);
check(true, `the owner co-signed on-chain: ${explorerTx(cosignTx)}`);
await runScheduledJob(admin);
b = await admin.get("Purchase Invoice", bill);
if (b.sendsure_state !== "Paid on Arc") {
  // The agent's answer can arrive after the job's first status read; the job reads again on its next run.
  await runScheduledJob(admin);
  b = await admin.get("Purchase Invoice", bill);
}
const after = await client.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [s.payee.address] });
check(b.sendsure_state === "Paid on Arc" && Boolean(b.sendsure_tx), `the next run of the job: the agent paid it on Arc, ${explorerTx(b.sendsure_tx)}`);
check(after - before === usdc("0.25"), `the supplier's proven address received ${formatUsdc(after - before)} USDC`);

// 6. Recorded in ERPNext, exactly, once
const paymentFields = ["name", "docstatus", "paid_amount", "received_amount", "paid_from", "paid_from_account_currency", "paid_to", "mode_of_payment", "reference_no", "sendsure_payout", "sendsure_amount_paid", "sendsure_receipt_url", "posting_date"];
const payments = await admin.list("Payment Entry", [["sendsure_tx", "=", b.sendsure_tx]], paymentFields);
const p = payments[0];
check(
  payments.length === 1 && p.docstatus === 1 && p.paid_amount === 0.25 && p.paid_from_account_currency === "USDC" && p.reference_no === b.sendsure_tx && p.sendsure_amount_paid === "0.250000",
  `recorded as Payment Entry ${p?.name}: ${p?.sendsure_amount_paid} ${p?.paid_from_account_currency}, reference "${p?.reference_no?.slice(0, 20)}…"`,
);
check(
  p?.sendsure_payout === s.payee.address && p?.paid_from === usdcAccount.name && p?.mode_of_payment === MODE && p?.sendsure_receipt_url === `${base}/receipt?tx=${b.sendsure_tx}`,
  `to the proven address, from "${p?.paid_from}", with a link to the SendSure receipt`,
);
const ledger = await admin.list("GL Entry", [["voucher_no", "=", p?.name], ["is_cancelled", "=", 0]], ["account", "debit", "credit", "credit_in_account_currency", "account_currency"]);
const out = ledger.find((g) => g.account === usdcAccount.name);
const payable = ledger.find((g) => g.account === p?.paid_to);
check(
  ledger.length === 2 && out?.credit === 0.25 && out?.credit_in_account_currency === 0.25 && out?.account_currency === "USDC" && payable?.debit === 0.25,
  `the ledger has two rows and nothing else: ${out?.credit_in_account_currency} USDC (${out?.credit} USD) out of the USDC account, ${payable?.debit} USD off "${payable?.account}"`,
);
check(b.status === "Paid" && b.outstanding_amount === 0 && b.sendsure_amount_paid === "0.250000", `invoice ${b.status}, ${b.outstanding_amount.toFixed(2)} left open, paid exactly ${b.sendsure_amount_paid} USDC`);
await runScheduledJob(admin);
await admin.method("sendsure_erpnext.purchase_invoice.refresh", { invoice: bill });
const again = await admin.list("Payment Entry", [["sendsure_tx", "=", b.sendsure_tx]], ["name"]);
check(again.length === 1, `syncing again records nothing twice`);
const manual = await refused(
  admin.create("Payment Entry", {
    payment_type: "Pay",
    company: company.name,
    party_type: "Supplier",
    party: supplier,
    mode_of_payment: MODE,
    paid_from: usdcAccount.name,
    paid_from_account_currency: "USDC",
    paid_to: company.default_payable_account,
    paid_to_account_currency: "USD",
    paid_amount: 1,
    received_amount: 1,
    source_exchange_rate: 1,
    target_exchange_rate: 1,
    reference_no: "by hand",
    reference_date: today,
    sendsure_tx: `0x${"ab".repeat(32)}`,
    sendsure_payout: s.payee.address,
  }),
);
check(/recorded by SendSure/.test(manual ?? ""), `a hand-made payment on the SendSure mode is refused, even with a transaction typed in: nothing is recorded without SendSure reading it from Arc`);
const bills = (await api(base, `/api/v1/bills?ids=${encodeURIComponent(b.sendsure_external_id)}`, { token: key })).body.bills as any[];
check(bills?.[0]?.settlement?.amount === "250000" && bills[0].settlement.payout === s.payee.address, `SendSure's view matches: Settled event carries 250000 (0.25 USDC) to ${s.payee.address}`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/erpnext-e2e.json"),
  `${JSON.stringify(withChecks(
    {
      note: "First-party end-to-end test: ERPNext 15 (Docker) with the sendsure_erpnext app, against the live SendSure, SANDBOX org with throwaway keys. Not traction.",
      ranAtUnix: Math.floor(Date.now() / 1000),
      base,
      erpnext: version,
      org: s.org,
      payee: s.payee.address,
      invoice: { name: b.name, invoiceRef, amountUsd: "0.25", status: b.status, sendsure: b.sendsure_state, externalId: b.sendsure_external_id },
      refused: { typedAddressClerk: clerkTyped, typedAddressAdministrator: adminTyped, clerkApprove, sendBeforeApproval: early, wrongAmountClaim: wrong.body.code, manualUsdcPayment: manual },
      cosign: explorerTx(cosignTx),
      settle: explorerTx(b.sendsure_tx),
      erpnextPayment: { name: p?.name, amount: p?.sendsure_amount_paid, currency: p?.paid_from_account_currency, account: p?.paid_from, modeOfPayment: p?.mode_of_payment, reference: p?.reference_no, postingDate: p?.posting_date },
      ledger,
      settlement: bills?.[0]?.settlement,
    }),
    null,
    2,
  )}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/erpnext-e2e.json");
process.exitCode = failed() ? 1 : 0;
