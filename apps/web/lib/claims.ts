// Server only. Claims: what a payee signed for one invoice. The server keeps the org's secret ref
// salt, checks every claim against the contract's own check() before storing it, and never
// stores payee names.
import { getAddress, recoverAddress, type Address, type Hex } from "viem";
import {
  OUTCOMES,
  REASONS,
  REASON_TEXT,
  claimIdOf,
  deployment,
  encodeClaim,
  formatUsdc,
  mandateAbi,
  mandateFactoryAbi,
  normalizeInvoiceRef,
  randomBytes32,
  randomNonce,
  readPayee,
  refHashOf,
  type Claim,
  type Outcome,
  type Reason,
} from "@sendsure/chain";
import { getDb } from "./db";
import { markProposalClaimed } from "./invoices";
import { inBackground, notifyOrg } from "./notify";
import { RelayError, isBytes32, isSignature, serverClient, toAddress, toObject, toUint } from "./relayer";

const USDC = deployment.usdc as Address;
const DAY = 86_400;
export const CLAIM_TTL_SECONDS = 30 * DAY;
const nowSec = () => Math.floor(Date.now() / 1000);

/** Reasons that mean the claim itself is wrong: it is refused, not stored. */
const CLAIM_FAULTS = new Set<Reason>([
  "TOKEN_NOT_ALLOWED",
  "ZERO_AMOUNT",
  "EXPIRED",
  "BAD_PERIOD",
  "NONCE_USED",
  "PAYEE_NOT_BOUND",
  "PAYEE_IS_CONTROLLER",
  "PAYEE_BLOCKLISTED",
  "BAD_SIGNATURE",
  "DUPLICATE_REF",
  "OVER_CLAIM_MAX",
]);

export async function orgSalt(org: Address): Promise<Hex> {
  const db = await getDb();
  const row = await db.first<{ ref_salt: Hex }>("SELECT ref_salt FROM orgs WHERE org = ?", org);
  if (row) return row.ref_salt;
  const isMandate = await serverClient.readContract({
    address: deployment.mandateFactory as Address,
    abi: mandateFactoryAbi,
    functionName: "isMandate",
    args: [org],
  });
  if (!isMandate) throw new RelayError(400, "That is not a SendSure org.", "NotOrg");
  await db.run("INSERT OR IGNORE INTO orgs (org, ref_salt, created_at) VALUES (?, ?, ?)", org, randomBytes32(), nowSec());
  const saved = await db.first<{ ref_salt: Hex }>("SELECT ref_salt FROM orgs WHERE org = ?", org);
  return saved!.ref_salt;
}

function toInvoiceRef(v: unknown): string {
  const ref = typeof v === "string" ? normalizeInvoiceRef(v) : "";
  if (!ref || ref.length > 64) throw new RelayError(400, "Enter the invoice number (up to 64 characters).", "BAD_INPUT");
  return ref;
}

async function boundPayee(org: Address, payeeRef: Hex) {
  const p = await readPayee(serverClient, org, payeeRef);
  if (p.state !== "BOUND") throw new RelayError(409, "This payee has not confirmed a payout address yet.", "PAYEE_NOT_BOUND");
  if (p.changePending) {
    throw new RelayError(
      409,
      "A change of payout address is waiting. Send claims after it takes effect.",
      "PAYEE_CHANGE_PENDING",
    );
  }
  return p;
}

// ------------------------------------------------------------------ prepare

/** What the payee needs before signing: the invoice's refHash (from the org's secret salt) and a nonce. */
export async function prepareClaim(session: Address, body: unknown) {
  const b = toObject(body);
  const org = toAddress(b.org, "org");
  if (!isBytes32(b.payeeRef)) throw new RelayError(400, "payeeRef must be 32 bytes of hex.", "BAD_INPUT");
  const invoiceRef = toInvoiceRef(b.invoiceRef);
  const payee = await boundPayee(org, b.payeeRef);
  if (payee.payout !== session) throw new RelayError(403, "Sign in with the wallet this payer pays.", "NotPayout");
  const refHash = refHashOf(await orgSalt(org), invoiceRef);
  const db = await getDb();
  const existing = await db.first<{ status: string }>(
    "SELECT status FROM claims WHERE org = ? AND payee_ref = ? AND ref_hash = ? AND status != 'withdrawn'",
    org,
    b.payeeRef,
    refHash,
  );
  if (existing) throw new RelayError(409, `Invoice ${invoiceRef} was already sent (${existing.status}).`, "DUPLICATE_REF");
  return {
    token: USDC,
    refHash,
    invoiceRef,
    nonce: randomNonce().toString(),
    validUntil: nowSec() + CLAIM_TTL_SECONDS,
  };
}

// ------------------------------------------------------------------ submit

export interface ClaimResult {
  claimId: Hex;
  outcome: Outcome;
  reason: Reason;
  reasonText: string;
  stored: boolean;
}

export async function submitClaim(body: unknown): Promise<ClaimResult> {
  const b = toObject(body);
  const org = toAddress(b.org, "org");
  const c = toObject(b.claim);
  if (!isBytes32(c.payeeRef) || !isBytes32(c.refHash))
    throw new RelayError(400, "payeeRef and refHash must be 32 bytes.", "BAD_INPUT");
  if (!isSignature(b.signature)) throw new RelayError(400, "signature must be 65 bytes of hex.", "BAD_INPUT");
  const claim: Claim = {
    payeeRef: c.payeeRef,
    token: toAddress(c.token, "token"),
    amount: toUint(c.amount, 128, "amount"),
    refHash: c.refHash,
    periodStart: toUint(c.periodStart, 64, "periodStart"),
    periodEnd: toUint(c.periodEnd, 64, "periodEnd"),
    nonce: toUint(c.nonce, 256, "nonce"),
    validUntil: toUint(c.validUntil, 64, "validUntil"),
  };
  const now = BigInt(nowSec());
  if (claim.token !== USDC) throw new RelayError(400, "Claims are paid in USDC.", "BAD_INPUT");
  if (claim.amount === 0n) throw new RelayError(400, "Enter an amount above zero.", "BAD_INPUT");
  if (claim.periodStart > claim.periodEnd) throw new RelayError(400, "The work period ends before it starts.", "BAD_INPUT");
  if (claim.periodEnd > now + BigInt(31 * DAY))
    throw new RelayError(400, "The work period is too far in the future.", "BAD_INPUT");
  if (claim.validUntil < now + 3_600n || claim.validUntil > now + BigInt(90 * DAY)) {
    throw new RelayError(400, "A claim must stay valid between 1 hour and 90 days.", "BAD_INPUT");
  }
  const invoiceRef = toInvoiceRef(b.invoiceRef);
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 500) : "";
  if (refHashOf(await orgSalt(org), invoiceRef) !== claim.refHash) {
    throw new RelayError(400, "The claim does not match the invoice number. Prepare it again.", "BAD_INPUT");
  }

  const payee = await boundPayee(org, claim.payeeRef);
  // A claim confirming an invoice the payer sent (read by AI, or a bill from their books) must match
  // that invoice: same payee, invoice number and amount. The payer's books then close to the cent.
  let proposal: { id: string } | null = null;
  if (typeof b.proposalId === "string" && b.proposalId) {
    const db0 = await getDb();
    const p = await db0.first<{ id: string; amount: string }>(
      "SELECT id, amount FROM proposals WHERE id = ? AND org = ? AND payee_ref = ? AND invoice_ref = ? AND status = 'proposed'",
      b.proposalId,
      org,
      claim.payeeRef,
      invoiceRef,
    );
    if (!p)
      throw new RelayError(409, "That invoice is no longer waiting for you, or its number was changed.", "PROPOSAL_MISMATCH");
    if (p.amount !== claim.amount.toString())
      throw new RelayError(
        409,
        "The amount differs from the invoice the payer sent. If it is wrong, reject the invoice and ask them to fix it.",
        "PROPOSAL_MISMATCH",
      );
    proposal = { id: p.id };
  }
  const claimId = claimIdOf(org, claim);
  const signer = await recoverAddress({ hash: claimId, signature: b.signature }).catch(() => null);
  if (signer !== payee.payout) throw new RelayError(400, REASON_TEXT.BAD_SIGNATURE, "BAD_SIGNATURE");

  // The contract's own dry run: the same rules settle() applies.
  const [outcomeIndex, reasonIndex] = await serverClient.readContract({
    address: org,
    abi: mandateAbi,
    functionName: "check",
    args: [encodeClaim(claim), b.signature],
  });
  const outcome = OUTCOMES[outcomeIndex] ?? "REFUSED";
  const reason = REASONS[reasonIndex] ?? "NONE";
  if (outcome === "ALREADY_SETTLED") throw new RelayError(409, "This invoice was already paid.", "ALREADY_SETTLED");
  if (outcome === "REFUSED" && CLAIM_FAULTS.has(reason)) throw new RelayError(400, REASON_TEXT[reason], reason);

  const db = await getDb();
  const ts = nowSec();
  try {
    await db.run(
      `INSERT INTO claims (claim_id, org, payee_ref, payout, token, amount, ref_hash, invoice_ref, period_start, period_end,
        nonce, valid_until, payee_sig, description, source, status, last_outcome, last_reason, checked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
      claimId,
      org,
      claim.payeeRef,
      payee.payout,
      claim.token,
      claim.amount.toString(),
      claim.refHash,
      invoiceRef,
      Number(claim.periodStart),
      Number(claim.periodEnd),
      claim.nonce.toString(),
      Number(claim.validUntil),
      b.signature,
      description,
      proposal ? "invoice" : "payee",
      outcome,
      reason,
      ts,
      ts,
      ts,
    );
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err)))
      throw new RelayError(409, `Invoice ${invoiceRef} was already sent.`, "DUPLICATE_REF");
    throw err;
  }
  if (proposal) await markProposalClaimed(org, proposal.id, claimId);
  await inBackground(
    notifyOrg(
      org,
      `New claim signed by a payee: invoice ${invoiceRef}, ${formatUsdc(claim.amount)} USDC. The contract says: ${REASON_TEXT[reason] ?? outcome}`,
    ),
  );
  return { claimId, outcome, reason, reasonText: REASON_TEXT[reason], stored: true };
}

// ------------------------------------------------------------------ list

export interface ClaimRow {
  claim_id: Hex;
  org: Address;
  payee_ref: Hex;
  payout: Address;
  amount: string;
  invoice_ref: string;
  period_start: number;
  period_end: number;
  valid_until: number;
  description: string;
  status: string;
  last_outcome: string | null;
  last_reason: string | null;
  settle_tx: string | null;
  agent_action: string | null;
  agent_reason: string | null;
  created_at: number;
}

/** An agent of the org (SendSure's Circle agent wallet or server agent). */
export async function isAgentOf(org: Address, who: Address): Promise<boolean> {
  return serverClient.readContract({ address: org, abi: mandateAbi, functionName: "isAgent", args: [who] }).catch(() => false);
}

export async function isOwnerOrApprover(org: Address, who: Address): Promise<boolean> {
  const [owner, approver] = await Promise.all([
    serverClient.readContract({ address: org, abi: mandateAbi, functionName: "owner" }).catch(() => null),
    serverClient.readContract({ address: org, abi: mandateAbi, functionName: "isApprover", args: [who] }).catch(() => false),
  ]);
  return owner === who || approver === true;
}

/** The org's owner and approvers see every claim; a payee sees their own. */
export async function listClaims(session: Address, orgParam: string | null, payeeRef: string | null) {
  const org = toAddress(orgParam, "org");
  const db = await getDb();
  const columns = `claim_id, org, payee_ref, payout, amount, invoice_ref, period_start, period_end, valid_until,
    description, status, last_outcome, last_reason, agent_action, agent_reason, settle_tx, created_at`;
  if (payeeRef) {
    if (!isBytes32(payeeRef)) throw new RelayError(400, "payeeRef must be 32 bytes of hex.", "BAD_INPUT");
    const p = await readPayee(serverClient, org, payeeRef);
    if (p.payout !== session && !(await isOwnerOrApprover(org, session))) {
      throw new RelayError(403, "Only this payee and the payer can see these claims.", "FORBIDDEN");
    }
    const rows = await db.all<ClaimRow>(
      `SELECT ${columns} FROM claims WHERE org = ? AND payee_ref = ? ORDER BY created_at DESC LIMIT 200`,
      org,
      payeeRef,
    );
    return { claims: rows.map(withText) };
  }
  if (!(await isOwnerOrApprover(org, session)))
    throw new RelayError(403, "Only the payer's owner and approvers can see claims.", "FORBIDDEN");
  const rows = await db.all<ClaimRow & { token: Address; ref_hash: Hex; nonce: string }>(
    `SELECT ${columns}, token, ref_hash, nonce FROM claims WHERE org = ? ORDER BY created_at DESC LIMIT 200`,
    org,
  );
  // Approvers co-sign the exact claim on-chain, so they get its abi-encoded bytes.
  return {
    claims: rows.map((r) => ({
      ...withText(r),
      claim_hex: encodeClaim({
        payeeRef: r.payee_ref,
        token: r.token,
        amount: BigInt(r.amount),
        refHash: r.ref_hash,
        periodStart: BigInt(r.period_start),
        periodEnd: BigInt(r.period_end),
        nonce: BigInt(r.nonce),
        validUntil: BigInt(r.valid_until),
      }),
    })),
  };
}

const withText = (r: ClaimRow) => ({
  ...r,
  payout: getAddress(r.payout),
  reason_text: r.last_reason ? (REASON_TEXT[r.last_reason as Reason] ?? r.last_reason) : null,
});
