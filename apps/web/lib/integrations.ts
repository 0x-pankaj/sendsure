// Server only. Books systems (Odoo first) talk to SendSure with an org integration key.
//   - The org's owner or an approver creates a key in /org. It is shown once; only its SHA-256 is kept.
//   - A key can: read the org, read payees by invite ref, check an address, send a posted bill (it becomes
//     a proposal the payee must sign), read each bill's status down to the settle tx, and ask the agent
//     to run. It can never approve, co-sign, open invites, change rules or move money itself.
import { getAddress, parseEventLogs, type Address, type Hex } from "viem";
import {
  REASON_TEXT,
  arcTestnet,
  deployment,
  formatUsdc,
  mandateAbi,
  normalizeInvoiceRef,
  readPayee,
  readPendingChange,
  refHashOf,
  usdc,
  type Reason,
} from "@sendsure/chain";
import { runAgent } from "./agent";
import { isOwnerOrApprover, orgSalt } from "./claims";
import { getDb } from "./db";
import { lookupPayee } from "./lookup";
import { RelayError, allow, isBytes32, serverClient, toAddress, toObject } from "./relayer";

const nowSec = () => Math.floor(Date.now() / 1000);
const MAX_KEYS_PER_ORG = 10;
const KEY_PREFIX = "ssk_";

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Buffer.from(new Uint8Array(d)).toString("hex");
}

// ------------------------------------------------------------------ keys (managed with a wallet session)

async function requireStaff(org: Address, who: Address) {
  if (!(await isOwnerOrApprover(org, who)))
    throw new RelayError(403, "Only the org's owner or an approver can manage integration keys.", "FORBIDDEN");
}

export async function createKey(session: Address, body: unknown) {
  const b = toObject(body);
  const org = toAddress(b.org, "org");
  await requireStaff(org, session);
  await orgSalt(org); // also refuses anything that is not a SendSure org
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 60) : "Odoo";
  const db = await getDb();
  const active = await db.first<{ n: number }>(
    "SELECT count(*) AS n FROM integration_keys WHERE org = ? AND revoked_at IS NULL",
    org,
  );
  if ((active?.n ?? 0) >= MAX_KEYS_PER_ORG)
    throw new RelayError(409, `An org can have ${MAX_KEYS_PER_ORG} active keys. Revoke one first.`, "TOO_MANY_KEYS");
  const key = `${KEY_PREFIX}${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
  const id = crypto.randomUUID();
  await db.run(
    "INSERT INTO integration_keys (id, org, key_hash, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    org,
    await sha256Hex(key),
    label,
    session,
    nowSec(),
  );
  return { id, org, label, key, note: "Copy this key now. SendSure keeps only a hash of it and cannot show it again." };
}

export async function listKeys(session: Address, orgParam: string | null) {
  const org = toAddress(orgParam, "org");
  await requireStaff(org, session);
  const db = await getDb();
  const keys = await db.all(
    "SELECT id, label, created_by, created_at, last_used_at, revoked_at FROM integration_keys WHERE org = ? ORDER BY created_at DESC",
    org,
  );
  return { keys };
}

export async function revokeKey(session: Address, body: unknown) {
  const b = toObject(body);
  const org = toAddress(b.org, "org");
  await requireStaff(org, session);
  const db = await getDb();
  const r = await db.run(
    "UPDATE integration_keys SET revoked_at = ? WHERE id = ? AND org = ? AND revoked_at IS NULL",
    nowSec(),
    String(b.id ?? ""),
    org,
  );
  if (r.changes === 0) throw new RelayError(404, "No such active key.", "NOT_FOUND");
  return { id: String(b.id), revoked: true };
}

/** The org an integration key belongs to, from `Authorization: Bearer ssk_…`, or a 401. */
export async function requireKey(req: Request): Promise<{ org: Address; keyId: string }> {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!key.startsWith(KEY_PREFIX) || key.length > 100)
    throw new RelayError(401, "Send your SendSure integration key as a Bearer token.", "UNAUTHENTICATED");
  const hash = await sha256Hex(key);
  if (!allow(`key:${hash}`, 600, 10 * 60_000)) throw new RelayError(429, "Too many requests for this key.", "RATE_LIMITED");
  const db = await getDb();
  const row = await db.first<{ id: string; org: Address; revoked_at: number | null; last_used_at: number | null }>(
    "SELECT id, org, revoked_at, last_used_at FROM integration_keys WHERE key_hash = ?",
    hash,
  );
  if (!row || row.revoked_at) throw new RelayError(401, "This integration key is not valid (or was revoked).", "UNAUTHENTICATED");
  const now = nowSec();
  if (!row.last_used_at || now - row.last_used_at > 60)
    await db.run("UPDATE integration_keys SET last_used_at = ? WHERE id = ?", now, row.id);
  return { org: getAddress(row.org), keyId: row.id };
}

// ------------------------------------------------------------------ what a key can do

export async function orgInfo(org: Address) {
  const [owner, tier] = await Promise.all([
    serverClient.readContract({ address: org, abi: mandateAbi, functionName: "owner" }),
    serverClient.readContract({ address: org, abi: mandateAbi, functionName: "tier" }).catch(() => 0),
  ]);
  return {
    org,
    owner,
    tier: tier === 2 ? "sandbox" : "production",
    chain: { id: arcTestnet.id, name: arcTestnet.name },
    token: { symbol: "USDC", address: deployment.usdc, decimals: 6 },
  };
}

const PAYEE_STATE_TEXT: Record<string, string> = {
  NONE: "not_invited",
  OPEN: "invited",
  BOUND: "bound",
  FROZEN: "frozen",
  REVOKED: "revoked",
};

/** Each invite ref's state and, once bound, the address the payee proved. */
export async function payees(org: Address, refsParam: string | null) {
  const refs = (refsParam ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (refs.length === 0 || refs.length > 50) throw new RelayError(400, "Pass 1 to 50 invite refs: ?refs=0x…,0x…", "BAD_INPUT");
  if (!refs.every(isBytes32)) throw new RelayError(400, "Each ref must be 32 bytes of hex (from the invite link).", "BAD_INPUT");
  const out = await Promise.all(
    (refs as Hex[]).map(async (payeeRef) => {
      const p = await readPayee(serverClient, org, payeeRef);
      const bound = p.state === "BOUND" || p.state === "FROZEN";
      const pending = bound && p.changePending ? await readPendingChange(serverClient, org, payeeRef) : null;
      return {
        payeeRef,
        state: PAYEE_STATE_TEXT[p.state] ?? "not_invited",
        payout: bound ? p.payout : null,
        proof: bound ? p.tier : null,
        payable: p.state === "BOUND" && !p.changePending,
        pendingChange: pending ? { newPayout: pending.newPayout, effectiveAt: Number(pending.effectiveAt) } : null,
      };
    }),
  );
  return { payees: out };
}

export async function verifyAddress(org: Address, addressParam: string | null) {
  return lookupPayee(org, toAddress(addressParam, "address"));
}

// ------------------------------------------------------------------ bills

const SYSTEMS = new Set(["odoo"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);

interface BillInput {
  system: string;
  externalId: string;
  payeeRef: Hex;
  invoiceRef: string;
  amount: bigint;
  amountText: string;
  currency: "USD" | "USDC";
  periodStart: number;
  periodEnd: number;
  description: string;
  document: string;
}

export function parseBill(body: unknown): BillInput {
  const b = toObject(body);
  const system = typeof b.system === "string" ? b.system : "odoo";
  if (!SYSTEMS.has(system)) throw new RelayError(400, "system must be odoo.", "BAD_INPUT");
  const externalId = typeof b.external_id === "string" ? b.external_id.trim() : "";
  if (!/^[\w.:/-]{1,80}$/.test(externalId))
    throw new RelayError(400, "external_id is required: the bill's id in your books (letters, digits, . : / - _).", "BAD_INPUT");
  if (!isBytes32(b.payee_ref)) throw new RelayError(400, "payee_ref must be the payee's invite ref (32 bytes of hex).", "BAD_INPUT");
  const invoiceRef = typeof b.invoice_ref === "string" ? normalizeInvoiceRef(b.invoice_ref) : "";
  if (!invoiceRef || invoiceRef.length > 64)
    throw new RelayError(400, "invoice_ref is required: the vendor's invoice number (up to 64 characters).", "BAD_INPUT");
  const amountText = typeof b.amount === "string" ? b.amount.trim() : "";
  // A decimal string, never a float: an amount with more than 6 decimals cannot be paid exactly in USDC.
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(amountText))
    throw new RelayError(400, "amount must be a decimal string with at most 6 decimals, e.g. \"250.00\".", "BAD_AMOUNT");
  const amount = usdc(amountText);
  if (amount <= 0n) throw new RelayError(400, "amount must be above zero.", "BAD_AMOUNT");
  const currency = typeof b.currency === "string" ? b.currency.toUpperCase() : "";
  if (currency !== "USD" && currency !== "USDC")
    throw new RelayError(400, "SendSure pays in USDC, so the bill must be in USD or USDC.", "BAD_CURRENCY");
  const invoiceDate = typeof b.invoice_date === "string" ? b.invoice_date : "";
  const start = typeof b.period_start === "string" && b.period_start ? b.period_start : invoiceDate;
  const end = typeof b.period_end === "string" && b.period_end ? b.period_end : invoiceDate;
  if (!DATE.test(start) || !DATE.test(end) || !Number.isFinite(dayStart(start)) || !Number.isFinite(dayStart(end)))
    throw new RelayError(400, "invoice_date (or period_start and period_end) must be YYYY-MM-DD.", "BAD_INPUT");
  const periodStart = dayStart(start);
  const periodEnd = dayStart(end) + 86_399;
  if (periodEnd < periodStart) throw new RelayError(400, "The period ends before it starts.", "BAD_INPUT");
  if (periodEnd > nowSec() + 31 * 86_400) throw new RelayError(400, "The bill's date is too far in the future.", "BAD_INPUT");
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 200) : "";
  const document = typeof b.document === "string" ? b.document.trim().slice(0, 80) : "";
  return {
    system,
    externalId,
    payeeRef: b.payee_ref as Hex,
    invoiceRef,
    amount,
    amountText,
    currency,
    periodStart,
    periodEnd,
    description,
    document,
  };
}

interface ProposalRow {
  id: string;
  payee_ref: Hex;
  invoice_ref: string;
  amount: string;
  status: string;
  claim_id: Hex | null;
  external_id: string;
  created_at: number;
}

/** A posted bill becomes a proposal the payee confirms by signing. Idempotent per bill. */
export async function createBill(org: Address, body: unknown, origin: string) {
  const bill = parseBill(body);
  const db = await getDb();
  const existing = await db.first<ProposalRow>(
    "SELECT * FROM proposals WHERE org = ? AND external_system = ? AND external_id = ?",
    org,
    bill.system,
    bill.externalId,
  );
  if (existing) {
    if (
      existing.payee_ref.toLowerCase() !== bill.payeeRef.toLowerCase() ||
      existing.invoice_ref !== bill.invoiceRef ||
      existing.amount !== bill.amount.toString()
    ) {
      throw new RelayError(
        409,
        "This bill was already sent with a different payee, invoice number or amount. Cancel it in SendSure's payee page first.",
        "BILL_CHANGED",
      );
    }
    return { ...(await billStatus(org, existing, origin)), duplicate: true };
  }

  const payee = await readPayee(serverClient, org, bill.payeeRef);
  if (payee.state !== "BOUND")
    throw new RelayError(409, "This vendor has not proved a payout address in SendSure yet.", "PAYEE_NOT_BOUND");
  if (payee.changePending)
    throw new RelayError(409, "This vendor's payout address is changing. Send the bill after the change takes effect.", "PAYEE_CHANGE_PENDING");

  const refHash = refHashOf(await orgSalt(org), bill.invoiceRef);
  const claim = await db.first<{ claim_id: Hex; amount: string; status: string }>(
    "SELECT claim_id, amount, status FROM claims WHERE org = ? AND payee_ref = ? AND ref_hash = ? AND status != 'withdrawn'",
    org,
    bill.payeeRef,
    refHash,
  );
  if (claim && claim.amount !== bill.amount.toString()) {
    throw new RelayError(
      409,
      `The vendor already claimed invoice ${bill.invoiceRef} for ${formatUsdc(BigInt(claim.amount))} USDC, not ${bill.amountText}.`,
      "AMOUNT_MISMATCH",
    );
  }
  const waiting = await db.first<{ id: string }>(
    "SELECT id FROM proposals WHERE org = ? AND payee_ref = ? AND invoice_ref = ? AND status = 'proposed'",
    org,
    bill.payeeRef,
    bill.invoiceRef,
  );
  if (waiting && !claim)
    throw new RelayError(409, `Invoice ${bill.invoiceRef} is already waiting for this vendor.`, "ALREADY_PROPOSED");

  const id = crypto.randomUUID();
  const now = nowSec();
  const extraction = {
    source: bill.system,
    fields: {
      document: bill.document,
      invoiceRef: bill.invoiceRef,
      amount: bill.amountText,
      currency: bill.currency,
      periodStart: new Date(bill.periodStart * 1000).toISOString().slice(0, 10),
      periodEnd: new Date(bill.periodEnd * 1000).toISOString().slice(0, 10),
    },
    warnings: [] as string[],
  };
  // A vendor who already signed a claim for this invoice (with the same amount) needs nothing more.
  await db.run(
    `INSERT INTO proposals (id, org, payee_ref, invoice_ref, amount, period_start, period_end, description, extraction, source, status,
       claim_id, external_system, external_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    org,
    bill.payeeRef,
    bill.invoiceRef,
    bill.amount.toString(),
    bill.periodStart,
    bill.periodEnd,
    bill.description,
    JSON.stringify(extraction),
    bill.system,
    claim ? "claimed" : "proposed",
    claim?.claim_id ?? null,
    bill.system,
    bill.externalId,
    now,
    now,
  );
  const row = await db.first<ProposalRow>("SELECT * FROM proposals WHERE id = ?", id);
  return { ...(await billStatus(org, row!, origin)), duplicate: false };
}

interface ClaimState {
  claim_id: Hex;
  amount: string;
  payout: Address;
  status: string;
  last_outcome: string | null;
  last_reason: string | null;
  agent_action: string | null;
  agent_reason: string | null;
  settle_tx: Hex | null;
}

/** The Settled event itself, read from the chain: the exact amount and address that were paid. */
async function settlement(org: Address, claimId: Hex, tx: Hex) {
  const receipt = await serverClient.getTransactionReceipt({ hash: tx });
  const [ev] = parseEventLogs({ abi: mandateAbi, logs: receipt.logs, eventName: "Settled" }).filter(
    (l) => l.address.toLowerCase() === org.toLowerCase() && l.args.claimId === claimId,
  );
  if (!ev) return null;
  const block = await serverClient.getBlock({ blockNumber: receipt.blockNumber });
  return {
    tx,
    block: Number(receipt.blockNumber),
    paidAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    amount: ev.args.amount.toString(),
    amountUsdc: formatUsdc(ev.args.amount),
    payout: ev.args.payout,
    token: ev.args.token,
    decisionHash: ev.args.decisionHash,
  };
}

async function billStatus(org: Address, p: ProposalRow, origin: string) {
  const base = {
    external_id: p.external_id,
    proposal_id: p.id,
    payee_ref: p.payee_ref,
    invoice_ref: p.invoice_ref,
    amount: p.amount,
    amount_usdc: formatUsdc(BigInt(p.amount)),
    claim_id: p.claim_id,
  };
  if (p.status === "proposed")
    return { ...base, status: "waiting_for_payee", reason: "Waiting for the vendor to confirm the bill by signing it in SendSure." };
  if (p.status === "rejected") return { ...base, status: "rejected_by_payee", reason: "The vendor said this bill is not theirs or is wrong." };
  if (!p.claim_id) return { ...base, status: p.status, reason: "" };
  const db = await getDb();
  const c = await db.first<ClaimState>("SELECT * FROM claims WHERE claim_id = ?", p.claim_id);
  if (!c) return { ...base, status: "waiting_for_payee", reason: "" };
  const reasonText = c.last_reason ? (REASON_TEXT[c.last_reason as Reason] ?? c.last_reason) : "";
  if (c.status === "settled" && c.settle_tx) {
    const paid = await settlement(org, c.claim_id, c.settle_tx);
    return {
      ...base,
      status: paid ? "paid" : "paid_unconfirmed",
      reason: paid ? "Paid on Arc to the vendor's proven address." : "Recorded as paid, but the Settled event was not found yet.",
      settlement: paid,
      receipt_url: `${origin}/receipt?tx=${c.settle_tx}`,
    };
  }
  if (c.status === "refused") return { ...base, status: "refused", reason: c.agent_reason || reasonText };
  if (c.status === "withdrawn") return { ...base, status: "withdrawn", reason: "The claim was withdrawn." };
  if (!c.agent_action) return { ...base, status: "signed", reason: "The vendor signed the bill. Waiting for the agent to run." };
  if (c.last_outcome === "ESCALATED" || (c.agent_action === "escalate" && c.last_outcome !== "PAYABLE"))
    return { ...base, status: "needs_cosign", reason: c.agent_reason || reasonText };
  return { ...base, status: "held", reason: c.agent_reason || reasonText };
}

export async function listBills(org: Address, idsParam: string | null, origin: string) {
  const db = await getDb();
  const ids = (idsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length > 100) throw new RelayError(400, "Ask for at most 100 bills at a time.", "BAD_INPUT");
  const rows = ids.length
    ? await db.all<ProposalRow>(
        `SELECT * FROM proposals WHERE org = ? AND external_id IN (${ids.map(() => "?").join(", ")})`,
        org,
        ...ids,
      )
    : await db.all<ProposalRow>(
        "SELECT * FROM proposals WHERE org = ? AND external_id IS NOT NULL ORDER BY created_at DESC LIMIT 100",
        org,
      );
  return { bills: await Promise.all(rows.map((r) => billStatus(org, r, origin))) };
}

/** Ask the agent to run now. It pays only claims that pass the contract; people still co-sign. */
export async function runAgentForKey(org: Address) {
  if (!allow(`agent-run:${org}`, 12, 60 * 60_000))
    throw new RelayError(429, "The agent ran many times this hour. Please wait a bit.", "RATE_LIMITED");
  const out = await runAgent(org, { execute: true });
  return {
    run_id: out.runId,
    planner: out.planner,
    summary: out.summary,
    decisions: out.decisions.map((d) => ({ claim_id: d.claimId, action: d.action, reason: d.reason, tx: d.tx ?? null })),
  };
}
