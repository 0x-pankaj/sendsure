// The first real SendSure payment on Arc mainnet, end to end through Odoo, with first-party test wallets:
// keys in .env.mainnet-test (git-ignored), both listed in the Worker's FIRST_PARTY_ADDRESSES, so it is never
// counted as traction.
//   1. the payer (wallet A) creates a production org with the beta's limits, through the relayer
//   2. a 2 USDC budget by permit; an invite; the vendor (wallet B) proves their wallet
//   3. an integration key; Odoo connects with it and sets up USDC and the journal
//   4. a 1 USD bill in Odoo -> "Pay with SendSure"; the vendor signs it in SendSure
//   5. Odoo's cron asks the agent to run: a first payment to a new address waits for a person; wallet A co-signs
//   6. the next run pays it on Arc mainnet; Odoo records it with the transaction, exactly, once
// Every step can be run again: what is done is kept in .sendsure-mainnet-first.json (git-ignored) and skipped.
//   NEXT_PUBLIC_ARC_NETWORK=mainnet pnpm tsx scripts/first-mainnet-payment.ts --odoo https://… [--db sendsure]
//   (the Odoo admin password comes from ODOO_ADMIN_PASSWORD, else .env.mainnet-odoo, else "admin" for a local copy)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  IS_MAINNET,
  arc,
  bindTypedData,
  claimTypes,
  createOrgMessage,
  deployment,
  explorerTx,
  formatUsdc,
  inviteBatchHash,
  mandateAbi,
  mandateDomain,
  openInvitesMessage,
  permitTypedData,
  randomBytes32,
  usdc,
  usdcPermitAbi,
  type Claim,
  type OrgRules,
} from "@sendsure/chain";
import { arg } from "./lib/env";
import { api, bindMessage, check, failed, postRelay, signInAs } from "./lib/relay";

if (!IS_MAINNET || arc.id !== 5042) throw new Error("Run with NEXT_PUBLIC_ARC_NETWORK=mainnet.");
const root = resolve(import.meta.dirname, "..");
for (const f of [".env.mainnet-test", ".env.mainnet-odoo"]) if (existsSync(resolve(root, f))) process.loadEnvFile(resolve(root, f));
const base = arg("base", "https://sendsure-mainnet.0xpankaj.workers.dev")!.replace(/\/$/, "");
const odooUrl = arg("odoo", "http://127.0.0.1:18090")!.replace(/\/$/, "");
const DB = arg("db", odooUrl.startsWith("http://127.0.0.1") ? "sendsure_mainnet" : "sendsure")!;
const odooPassword = odooUrl.startsWith("http://127.0.0.1") ? "admin" : (process.env.ODOO_ADMIN_PASSWORD ?? "");
const rpcUrl = "https://rpc.mainnet.arc.io";
const BILL_USD = "1";
const BILL_REF = "SENDSURE-MAINNET-1";

const owner = privateKeyToAccount(process.env.TEST_OWNER_PRIVATE_KEY as Hex);
const payee = privateKeyToAccount(process.env.TEST_PAYEE_PRIVATE_KEY as Hex);
const client = createPublicClient({ chain: arc, transport: http(rpcUrl) });
const USDC = deployment.usdc as Address;
const now = () => BigInt(Math.floor(Date.now() / 1000));
const balanceOf = (a: Address) => client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });

const STATE = resolve(root, ".sendsure-mainnet-first.json");
type State = { org?: Address; payeeRef?: Hex; bound?: boolean; budget?: boolean; odooConnected?: boolean };
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });

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
const uid = await rpc("common", "login", [DB, "admin", odooPassword]);
if (!uid) throw new Error(`cannot sign in to Odoo at ${odooUrl} (database ${DB})`);
const odoo = (model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
  rpc("object", "execute_kw", [DB, uid, odooPassword, model, method, args, kwargs]);
check(true, `Odoo ${(await rpc("common", "version", [])).server_version} at ${odooUrl}`);

// ------------------------------------------------------------------ 0. the site and the wallets

const status = (await api(base, "/api/status")).body;
check(status.chain?.id === 5042 && status.contracts?.payeeRegistry === deployment.payeeRegistry, `SendSure on ${status.chain?.name} (${base})`);
const ownerUsdc = await balanceOf(owner.address);
check(ownerUsdc >= usdc("1.01"), `wallet A ${owner.address} holds ${formatUsdc(ownerUsdc)} USDC (the bill is ${BILL_USD}, plus gas for one co-sign)`);
if (failed()) throw new Error("Fund wallet A first.");

// ------------------------------------------------------------------ 1. the org

if (!state.org) {
  const rules: OrgRules = {
    owner: owner.address,
    approvers: [owner.address],
    caps: DEFAULT_CAPS,
    periodLength: DEFAULT_PERIOD_SECONDS,
    changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
    sandbox: false,
  };
  const validUntil = now() + 1800n;
  const created = await api(base, "/api/org/create", {
    body: { ...rules, validUntil, signature: await owner.signMessage({ message: createOrgMessage(rules, validUntil) }) },
  });
  if (created.status !== 200) throw new Error(`org not created: ${JSON.stringify(created.body)}`);
  state.org = created.body.org as Address;
  save();
}
const org = state.org!;
check(true, `org ${org} (production, the beta's limits), owner and approver: wallet A`);

// ------------------------------------------------------------------ 2. budget, invite, the vendor proves their wallet

if (!state.budget) {
  const nonce = await client.readContract({ address: USDC, abi: usdcPermitAbi, functionName: "nonces", args: [owner.address] });
  const p = { owner: owner.address, spender: org, value: usdc("2"), nonce, deadline: now() + 1800n };
  const res = await api(base, "/api/org/budget", { body: { ...p, signature: await owner.signTypedData(permitTypedData(p)) } });
  if (res.status !== 200) throw new Error(`budget not set: ${JSON.stringify(res.body)}`);
  state.budget = true;
  save();
}
const allowance = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [owner.address, org] });
check(allowance >= usdc(BILL_USD), `budget: SendSure may spend ${formatUsdc(allowance)} USDC from wallet A`);

if (!state.payeeRef) {
  const payeeRef = randomBytes32();
  const validUntil = now() + 600n;
  const invited = await api(base, "/api/org/invites", {
    body: {
      org,
      payeeRefs: [payeeRef],
      validUntil,
      signature: await owner.signMessage({ message: openInvitesMessage(org, inviteBatchHash([payeeRef]), 1, validUntil) }),
    },
  });
  if (invited.status !== 200) throw new Error(`invite not opened: ${JSON.stringify(invited.body)}`);
  state.payeeRef = payeeRef;
  save();
}
const payeeRef = state.payeeRef!;
if (!state.bound) {
  const bm = bindMessage(org, payeeRef, payee.address);
  const bound = await postRelay(base, "bind", { ...bm, signature: await payee.signTypedData(bindTypedData(bm)) });
  if (bound.status !== 200 || bound.body.status !== "success") throw new Error(`bind failed: ${JSON.stringify(bound.body)}`);
  state.bound = true;
  save();
}
check(true, `the vendor (wallet B ${payee.address}) proved their wallet for invite ${payeeRef.slice(0, 10)}…`);
const ownerToken = await signInAs(base, owner);
const payeeToken = await signInAs(base, payee);

// ------------------------------------------------------------------ 3. Odoo connects with an integration key

if (!state.odooConnected) {
  const created = await api(base, "/api/org/keys", { token: ownerToken, body: { org, label: "Odoo (first mainnet payment)" } });
  const key = created.body.key as string;
  if (created.status !== 200 || !key?.startsWith("ssk_")) throw new Error(`no key: ${JSON.stringify(created.body)}`);
  await odoo("ir.config_parameter", "set_param", ["sendsure.url", base]);
  await odoo("ir.config_parameter", "set_param", ["sendsure.api_key", key]);
  const settings = await odoo("res.config.settings", "create", [{}]);
  await odoo("res.config.settings", "action_sendsure_test", [[settings]]);
  state.odooConnected = true;
  save();
}
const connected = await odoo("ir.config_parameter", "get_param", ["sendsure.org"]);
const chainSeen = await odoo("ir.config_parameter", "get_param", ["sendsure.chain_id"]);
check(connected?.toLowerCase() === org.toLowerCase() && chainSeen === "5042", `Odoo connected to org ${connected}, and knows it is on Arc mainnet (chain ${chainSeen})`);

// ------------------------------------------------------------------ 4. the vendor and the bill in Odoo

const invite = `${base}/verify?org=${org}&ref=${payeeRef}&name=SendSure%20mainnet%20test`;
const vendorName = "Mainnet Test Vendor (first-party, wallet B)";
let [vendor] = await odoo("res.partner", "search", [[["name", "=", vendorName]]]);
if (!vendor) vendor = await odoo("res.partner", "create", [{ name: vendorName, is_company: true, sendsure_payee_ref: invite }]);
await odoo("res.partner", "action_sendsure_refresh", [[vendor]]);
const wallets = (await odoo("res.partner.bank", "search_read", [[["partner_id", "=", vendor]]], { fields: ["acc_number", "allow_out_payment"] })) as {
  id: number;
  acc_number: string;
  allow_out_payment: boolean;
}[];
const proven = wallets.find((w) => w.acc_number.toLowerCase() === payee.address.toLowerCase());
check(Boolean(proven), `Odoo read the vendor's proven address from SendSure: ${proven?.acc_number}`);
if (proven && !proven.allow_out_payment) await odoo("res.partner.bank", "write", [[proven.id], { allow_out_payment: true }]);

let [bill] = await odoo("account.move", "search", [[["ref", "=", BILL_REF], ["move_type", "=", "in_invoice"]]]);
if (!bill) {
  bill = await odoo("account.move", "create", [
    {
      move_type: "in_invoice",
      partner_id: vendor,
      invoice_date: new Date().toISOString().slice(0, 10),
      ref: BILL_REF,
      currency_id: (await odoo("ir.model.data", "check_object_reference", ["base", "USD"]))[1],
      invoice_line_ids: [[0, 0, { name: "First SendSure payment on Arc mainnet (first-party test)", quantity: 1, price_unit: Number(BILL_USD), tax_ids: [[6, 0, []]] }]],
    },
  ]);
  await odoo("account.move", "action_post", [[bill]]);
}
const readBill = async () =>
  (
    await odoo("account.move", "read", [[bill]], {
      fields: ["name", "state", "sendsure_state", "sendsure_reason", "sendsure_tx", "sendsure_amount_paid", "payment_state", "amount_residual"],
    })
  )[0];
let b = await readBill();
if (!b.sendsure_state) {
  await odoo("account.move", "action_sendsure_send", [[bill]]);
  b = await readBill();
}
check(Boolean(b.sendsure_state), `bill ${b.name} (${BILL_REF}, ${BILL_USD} USD) sent with "Pay with SendSure": ${b.sendsure_state}`);

// ------------------------------------------------------------------ 5. the vendor signs; Odoo asks the agent; wallet A co-signs

if (b.sendsure_state === "waiting_for_payee") {
  const proposals = (await api(base, `/api/invoices?org=${org}&ref=${payeeRef}`, { token: payeeToken })).body.proposals as any[];
  const p = proposals.find((x) => x.source === "odoo" && x.invoice_ref === BILL_REF && (x.status ?? "proposed") === "proposed");
  if (!p) throw new Error("the vendor cannot see the bill in SendSure");
  const prep = (await api(base, "/api/claims/prepare", { token: payeeToken, body: { org, payeeRef, invoiceRef: p.invoice_ref } })).body;
  const claim: Claim = {
    payeeRef,
    token: prep.token,
    amount: BigInt(p.amount),
    refHash: prep.refHash,
    periodStart: BigInt(p.period_start),
    periodEnd: BigInt(p.period_end),
    nonce: BigInt(prep.nonce),
    validUntil: BigInt(prep.validUntil),
  };
  const signature = await payee.signTypedData({ domain: mandateDomain(org), types: claimTypes, primaryType: "Claim", message: claim });
  const signed = await api(base, "/api/claims", {
    body: { org, claim, invoiceRef: p.invoice_ref, description: "First SendSure payment on Arc mainnet", signature, proposalId: p.id },
  });
  check(signed.status === 200, `the vendor signed ${formatUsdc(BigInt(p.amount))} USDC for ${BILL_REF}: ${signed.body.outcome ?? signed.body.error}`);
}
const cron = (await odoo("ir.model.data", "check_object_reference", ["sendsure_payables", "ir_cron_sendsure_sync"]))[1];
await odoo("ir.cron", "method_direct_trigger", [[cron]]);
b = await readBill();
check(true, `Odoo's cron asked the agent to run: ${b.sendsure_state} (${b.sendsure_reason ?? ""})`);

if (b.sendsure_state === "needs_cosign") {
  const view = await api(base, `/api/claims?org=${org}`, { token: ownerToken });
  const open = (view.body.claims as any[]).find((c) => c.invoice_ref === BILL_REF && c.claim_hex && c.status !== "settled");
  if (!open) throw new Error("no claim to co-sign");
  const wallet = createWalletClient({ account: owner, chain: arc, transport: http(rpcUrl) });
  const tx = await wallet.writeContract({ address: org, abi: mandateAbi, functionName: "cosign", args: [open.claim_hex as Hex] });
  await client.waitForTransactionReceipt({ hash: tx });
  check(true, `wallet A co-signed on-chain: ${explorerTx(tx)}`);
  const before = await balanceOf(payee.address);
  await odoo("ir.cron", "method_direct_trigger", [[cron]]);
  b = await readBill();
  const after = await balanceOf(payee.address);
  check(after - before === usdc(BILL_USD), `the vendor's proven address received ${formatUsdc(after - before)} USDC`);
}

// ------------------------------------------------------------------ 6. paid on Arc mainnet, recorded in Odoo

check(b.sendsure_state === "paid" && Boolean(b.sendsure_tx), `paid on Arc mainnet: ${b.sendsure_tx ? explorerTx(b.sendsure_tx) : b.sendsure_state}`);
const payments = (await odoo("account.payment", "search_read", [[["sendsure_tx", "=", b.sendsure_tx || "none"]]], {
  fields: ["name", "amount", "currency_id", "journal_id", "state"],
})) as any[];
check(payments.length === 1 && b.payment_state !== "not_paid", `Odoo recorded it once: ${payments[0]?.name}, ${payments[0]?.amount} ${payments[0]?.currency_id?.[1]}; bill ${b.payment_state}, ${b.amount_residual} open`);

if (b.sendsure_tx) {
  const out = {
    what: "The first SendSure payment on Arc mainnet: first-party test wallets, through Odoo. Not traction.",
    at: new Date().toISOString(),
    site: base,
    odoo: odooUrl,
    org,
    payer: owner.address,
    payee: payee.address,
    bill: { odoo: b.name, ref: BILL_REF, usd: BILL_USD },
    settleTx: b.sendsure_tx,
    explorer: explorerTx(b.sendsure_tx),
    receipt: `${base}/receipt?tx=${b.sendsure_tx}`,
    odooPayment: payments[0]?.name,
  };
  writeFileSync(resolve(root, "deployments/first-mainnet-payment.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote deployments/first-mainnet-payment.json\nreceipt: ${out.receipt}`);
}
if (failed()) process.exitCode = 1;
