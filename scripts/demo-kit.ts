// One command to a ready demo: a SANDBOX payer org (never counted as traction) connected to a test Odoo, without a
// browser wallet. For a call with a lead, or for a lead trying SendSure on a test copy of their own Odoo.
//
//   pnpm demo-kit                 set up (or reuse) the org, connect Odoo, link a vendor to a fresh invite
//   pnpm demo-kit cosign          co-sign every claim that waits for a person (a first payment, a large one)
//
// Options: --odoo http://127.0.0.1:18069  --db sendsure  --vendor "Northwind Studio (demo)"  --base https://…
// (with ODOO_VERSION=16, 17 or 18 set, as in Codespaces, the defaults follow integrations/odoo/run.sh: port 180xx).
// It uses only SendSure's public API: the relayer pays the gas, SendSure's faucet gives 2 test USDC once. The org's
// owner key (test money only) is kept in .sendsure-demo.json, git-ignored: it signs the budget and the co-signs.
// The vendor's side stays real: they open the invite on their phone and prove a wallet (a passkey is enough).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  arcTestnet,
  createOrgMessage,
  deployment,
  formatUsdc,
  inviteBatchHash,
  mandateAbi,
  openInvitesMessage,
  permitTypedData,
  randomBytes32,
  readMandate,
  usdc,
  usdcPermitAbi,
  type OrgRules,
} from "@sendsure/chain";
import { arg } from "./lib/env";
import { api, signInAs } from "./lib/relay";

const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!.replace(/\/$/, "");
// The test copy that integrations/odoo/run.sh started (ODOO_VERSION=17 -> port 18017, database sendsure17).
const version = process.env.ODOO_VERSION && process.env.ODOO_VERSION !== "19" ? process.env.ODOO_VERSION : "";
const odooUrl = arg("odoo", version ? `http://127.0.0.1:180${version}` : "http://127.0.0.1:18069")!.replace(/\/$/, "");
const db = arg("db", `sendsure${version}`)!;
const vendorName = arg("vendor", "Northwind Studio (demo)")!;
const STATE = resolve(import.meta.dirname, "../.sendsure-demo.json");
const client = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
const now = () => BigInt(Math.floor(Date.now() / 1000));

interface State {
  base: string;
  org: Address;
  ownerKey: Hex;
  createdAt: string;
}

function load(): State | null {
  if (!existsSync(STATE)) return null;
  const s = JSON.parse(readFileSync(STATE, "utf8")) as State;
  return s.base === base ? s : null;
}

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

async function odoo() {
  const user = arg("odoo-user", "admin")!;
  const password = arg("odoo-password", "admin")!;
  // A test copy started a moment ago is still installing: wait for it (up to 10 minutes).
  let uid: number | false = false;
  for (let i = 0; ; i++) {
    try {
      uid = await rpc("common", "login", [db, user, password]);
      if (uid) break;
    } catch (err) {
      if (i >= 120) throw new Error(`Cannot reach Odoo at ${odooUrl} (database ${db}): ${(err as Error).message}. Start it with integrations/odoo/run.sh up.`);
    }
    if (i >= 120) break;
    if (i % 6 === 0) console.log(`Waiting for Odoo at ${odooUrl} (database ${db}) to finish installing...`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!uid) throw new Error(`Odoo refused ${user} on database ${db}.`);
  return (model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) =>
    rpc("object", "execute_kw", [db, uid, password, model, method, args, kwargs]);
}

// ------------------------------------------------------------------ set up

async function setUp() {
  const call = await odoo();
  let state = load();
  const ownerKey = state?.ownerKey ?? generatePrivateKey();
  const owner = privateKeyToAccount(ownerKey);
  if (!state) {
    const rules: OrgRules = {
      owner: owner.address,
      approvers: [owner.address],
      caps: DEFAULT_CAPS,
      periodLength: DEFAULT_PERIOD_SECONDS,
      changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
      sandbox: true,
    };
    const vu = now() + 1800n;
    const created = await api(base, "/api/org/create", {
      body: { ...rules, validUntil: vu, signature: await owner.signMessage({ message: createOrgMessage(rules, vu) }) },
    });
    if (created.status !== 200 || !created.body.org) throw new Error(`The org was not created: ${JSON.stringify(created.body)}`);
    state = { base, org: created.body.org as Address, ownerKey, createdAt: new Date().toISOString() };
    writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    console.log(`Created a SANDBOX org ${state.org} (never counted as traction). Its key is in .sendsure-demo.json.`);
  } else {
    console.log(`Using the SANDBOX org ${state.org} from .sendsure-demo.json.`);
  }
  const org = state.org;
  const token = await signInAs(base, owner);

  // Test USDC, once per wallet, from SendSure's faucet; and a budget the org may spend from it.
  const drip = await api(base, "/api/faucet", { token, body: {} });
  console.log(drip.status === 200 ? "Got 2 test USDC from SendSure's faucet." : `Faucet: ${drip.body.error}`);
  const m = await readMandate(client, org);
  if (m.allowance < usdc(5)) {
    const nonce = await client.readContract({ address: deployment.usdc as Address, abi: usdcPermitAbi, functionName: "nonces", args: [owner.address] });
    const permit = { owner: owner.address, spender: org, value: usdc(10), nonce, deadline: now() + 1800n };
    const budget = await api(base, "/api/org/budget", { body: { ...permit, signature: await owner.signTypedData(permitTypedData(permit)) } });
    if (budget.status !== 200) throw new Error(`The budget was not set: ${JSON.stringify(budget.body)}`);
  }

  // Odoo: a books key for this org (only when Odoo is not connected to it yet), then Test connection.
  const connected = String((await call("ir.config_parameter", "get_param", ["sendsure.org"])) ?? "");
  if (connected.toLowerCase() !== org.toLowerCase()) {
    const created = await api(base, "/api/org/keys", { token, body: { org, label: `Odoo demo (${db})` } });
    if (created.status !== 200) throw new Error(`No books key: ${JSON.stringify(created.body)}`);
    await call("ir.config_parameter", "set_param", ["sendsure.url", base]);
    await call("ir.config_parameter", "set_param", ["sendsure.api_key", created.body.key]);
  }
  const settings = await call("res.config.settings", "create", [{}]);
  await call("res.config.settings", "action_sendsure_test", [[settings]]);

  // The vendor: linked to a fresh invite, so the demo starts from "the vendor proves their wallet".
  let [vendor] = await call("res.partner", "search_read", [[["name", "=", vendorName]]], { fields: ["id", "sendsure_state"], limit: 1 });
  if (!vendor) {
    const id = await call("res.partner", "create", [{ name: vendorName, is_company: true, supplier_rank: 1 }]);
    vendor = { id, sendsure_state: false };
  }
  let invite: string | null = null;
  if (!["bound", "change_pending"].includes(vendor.sendsure_state)) {
    const ref = randomBytes32();
    const ivu = now() + 600n;
    const opened = await api(base, "/api/org/invites", {
      body: {
        org,
        payeeRefs: [ref],
        validUntil: ivu,
        signature: await owner.signMessage({ message: openInvitesMessage(org, inviteBatchHash([ref]), 1, ivu) }),
      },
    });
    if (opened.status !== 200) throw new Error(`The invite was not opened: ${JSON.stringify(opened.body)}`);
    const company = (await call("res.company", "search_read", [[]], { fields: ["name"], limit: 1 }))[0]?.name ?? "";
    invite = `${base}/verify?${new URLSearchParams({ org, ref, name: company })}`;
    await call("res.partner", "write", [[vendor.id], { sendsure_payee_ref: invite }]);
  }

  const after = await readMandate(client, org);
  console.log(`
Ready. Odoo at ${odooUrl} (database ${db}) is connected to the SANDBOX org ${org}.
  Wallet ${formatUsdc(after.treasuryBalance)} USDC, budget ${formatUsdc(after.allowance)}; one bill up to ${formatUsdc(after.caps.claimMax)}, a person co-signs above ${formatUsdc(after.caps.coSignThreshold)}.
${invite ? `  "${vendorName}" is linked to a new invite. The vendor opens it on their phone and proves a wallet ("Create a passkey wallet"):\n  ${invite}` : `  "${vendorName}" already proved a wallet.`}

Then, in Odoo: the vendor > Invoicing tab > "Check with SendSure", and trust the wallet (Bank accounts > Send Money).
A posted bill in USD of about 1 USD with the vendor's invoice number > "Pay with SendSure" > "Email the vendor to sign".
The vendor signs it on the same link. A first payment waits for a person: pnpm demo-kit cosign
Then "Run the agent now" on the bill: paid on Arc, and recorded in Odoo with the transaction.`);
}

// ------------------------------------------------------------------ co-sign

async function cosign() {
  const state = load();
  if (!state) throw new Error("No demo org yet: run pnpm demo-kit first.");
  const owner = privateKeyToAccount(state.ownerKey);
  const token = await signInAs(base, owner);
  const view = await api(base, `/api/claims?org=${state.org}`, { token });
  // Waiting for a person: the contract asks for a co-sign (a first payment, a large one), or Claude asked for one or
  // held a claim the rules would pay (SendSure's own pages show both as "Needs a co-sign" / "On hold").
  type Row = { claim_id: Hex; claim_hex: Hex; status: string; last_outcome: string; agent_action: string | null; invoice_ref?: string };
  const waiting = ((view.body.claims ?? []) as Row[]).filter(
    (c) =>
      c.status === "open" &&
      (c.last_outcome === "ESCALATED" || c.agent_action === "escalate" || (c.agent_action === "hold" && c.last_outcome === "PAYABLE")),
  );
  const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
  let done = 0;
  for (const c of waiting) {
    const by = await client.readContract({ address: state.org, abi: mandateAbi, functionName: "cosignedBy", args: [c.claim_id] });
    if (by !== "0x0000000000000000000000000000000000000000") continue;
    const tx = await wallet.writeContract({ address: state.org, abi: mandateAbi, functionName: "cosign", args: [c.claim_hex] });
    await client.waitForTransactionReceipt({ hash: tx });
    console.log(`Co-signed ${c.invoice_ref ?? c.claim_id}: ${arcTestnet.blockExplorers?.default.url}/tx/${tx}`);
    done++;
  }
  console.log(done ? `Co-signed ${done}. Now "Run the agent now" on the bill in Odoo.` : "Nothing waits for a co-sign.");
}

await (process.argv[2] === "cosign" ? cosign() : setUp());
