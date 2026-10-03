"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { explorerTx, formatUsdc, usdc, type Claim } from "@sendsure/chain";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { sendCosign, signClaim, walletErrorText, type Signer } from "../lib/wallet";
import { PayeeInvoices, type InvoiceProposal } from "./Invoices";

export interface ClaimView {
  claim_id: Hex;
  payee_ref: Hex;
  payout: Address;
  amount: string;
  invoice_ref: string;
  period_start: number;
  period_end: number;
  description: string;
  status: string;
  last_outcome: string | null;
  last_reason: string | null;
  reason_text: string | null;
  settle_tx: string | null;
  agent_action?: string | null;
  agent_reason?: string | null;
  claim_hex?: Hex;
  created_at: number;
}

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** One status chip per claim, in words a payee and a payer both understand. */
export function claimStatus(c: ClaimView): [chip: string, label: string, detail: string | null] {
  if (c.status === "settled") return ["PAY", "Paid", null];
  if (c.status === "refused") return ["STOP", "Refused", c.reason_text];
  if (c.status === "withdrawn") return ["STOP", "Withdrawn", null];
  if (c.agent_action === "escalate") return ["REVIEW", "Needs a co-sign", c.agent_reason ?? c.reason_text];
  if (c.agent_action === "hold") return ["STOP", "On hold", c.agent_reason ?? c.reason_text];
  if (c.last_outcome === "PAYABLE") return ["PAY", "Ready to pay", "The SendSure agent pays it on its next run."];
  if (c.last_outcome === "ESCALATED") return ["REVIEW", "Needs a co-sign", c.reason_text];
  return ["STOP", "On hold", c.reason_text];
}

export function ClaimTable(props: {
  claims: ClaimView[];
  payeeName?: (ref: Hex) => string;
  action?: (c: ClaimView) => React.ReactNode;
}) {
  const { claims, payeeName, action } = props;
  if (!claims.length) return <p className="hint">No claims yet.</p>;
  return (
    <div className="table-wrap">
      <table style={{ minWidth: 640 }}>
        <thead>
          <tr>
            {payeeName && <th>Payee</th>}
            <th>Invoice</th>
            <th>Amount</th>
            <th>Work period</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => {
            const [chip, label, detail] = claimStatus(c);
            return (
              <tr key={c.claim_id}>
                {payeeName && <td>{payeeName(c.payee_ref)}</td>}
                <td>
                  <span className="mono">{c.invoice_ref}</span>
                  {c.description && <div className="hint">{c.description}</div>}
                </td>
                <td>{formatUsdc(BigInt(c.amount))} USDC</td>
                <td>
                  {day(c.period_start)} to {day(c.period_end)}
                </td>
                <td>
                  <span className={`chip ${chip}`}>{label}</span>
                  {detail && <div className="hint">{detail}</div>}
                  {c.settle_tx && (
                    <div className="hint">
                      <a href={explorerTx(c.settle_tx)}>payment tx</a>
                    </div>
                  )}
                  {action?.(c)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The payee's side: send a claim for an invoice, and see earlier claims. */
export function PayeeClaims(props: { org: Address; payeeRef: Hex; signer: Signer; payer: string }) {
  const { org, payeeRef, signer, payer } = props;
  const [claims, setClaims] = useState<ClaimView[] | null>(null);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(() => day(Math.floor(Date.now() / 1000) - 30 * 86_400));
  const [to, setTo] = useState(() => day(Math.floor(Date.now() / 1000)));
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ outcome: string; reasonText: string; invoice: string } | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [invoicesVersion, setInvoicesVersion] = useState(0);

  /** Fill the form from an invoice the payer uploaded (the payee still checks it and signs). */
  function fillFromInvoice(p: InvoiceProposal) {
    setInvoiceRef(p.invoice_ref);
    setAmount(formatUsdc(BigInt(p.amount)));
    setFrom(day(p.period_start));
    setTo(day(p.period_end));
    setDescription(p.description);
    setProposalId(p.id);
    setResult(null);
  }

  const load = useCallback(async () => {
    try {
      const out = await jsonOrThrow<{ claims: ClaimView[] }>(await authedFetch(signer, `/api/claims?org=${org}&ref=${payeeRef}`));
      setClaims(out.claims);
    } catch (err) {
      setError(walletErrorText(err));
    }
  }, [org, payeeRef, signer]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setError("");
    setResult(null);
    setBusy("prepare");
    try {
      const periodStart = BigInt(Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000));
      const periodEnd = BigInt(Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000));
      if (!invoiceRef.trim()) throw new Error("Enter the invoice number.");
      if (!(Number(amount) > 0)) throw new Error("Enter the amount in USDC.");
      const prep = await jsonOrThrow<{ token: Address; refHash: Hex; invoiceRef: string; nonce: string; validUntil: number }>(
        await authedFetch(signer, "/api/claims/prepare", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org, payeeRef, invoiceRef }),
        }),
      );
      const claim: Claim = {
        payeeRef,
        token: prep.token,
        amount: usdc(amount),
        refHash: prep.refHash,
        periodStart,
        periodEnd,
        nonce: BigInt(prep.nonce),
        validUntil: BigInt(prep.validUntil),
      };
      setBusy("sign");
      const signature = await signClaim(signer, org, claim);
      setBusy("send");
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          { org, claim, invoiceRef: prep.invoiceRef, description, signature, proposalId: proposalId ?? undefined },
          (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        ),
      });
      const out = await jsonOrThrow<{ outcome: string; reasonText: string }>(res);
      setResult({ ...out, invoice: prep.invoiceRef });
      setProposalId(null);
      setInvoicesVersion((n) => n + 1);
      setInvoiceRef("");
      setAmount("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error && /invalid|decimal/i.test(err.message) ? "Check the amount." : walletErrorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Send {payer} a claim</h3>
      <PayeeInvoices org={org} payeeRef={payeeRef} signer={signer} payer={payer} onUse={fillFromInvoice} version={invoicesVersion} />
      {proposalId && (
        <p className="hint">Filled from {payer}&apos;s invoice. Check every field; you are signing it as your claim.</p>
      )}
      <p className="hint">
        One claim per invoice. You sign it with this wallet, so nobody else can change the amount or where it is paid.
      </p>
      <div className="grid">
        <div>
          <label htmlFor="inv">Invoice number</label>
          <input
            id="inv"
            value={invoiceRef}
            onChange={(e) => setInvoiceRef(e.target.value)}
            placeholder="INV-2026-014"
            style={{ width: "100%", padding: 8 }}
          />
        </div>
        <div>
          <label htmlFor="amt">Amount (USDC)</label>
          <input
            id="amt"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="40"
            style={{ width: "100%", padding: 8 }}
          />
        </div>
        <div>
          <label htmlFor="from">Work from</label>
          <input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ width: "100%", padding: 8 }}
          />
        </div>
        <div>
          <label htmlFor="to">Work to</label>
          <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", padding: 8 }} />
        </div>
      </div>
      <label htmlFor="desc" style={{ marginTop: 12 }}>
        What was the work? (optional)
      </label>
      <textarea
        id="desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{ minHeight: 60 }}
        maxLength={500}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy !== ""} onClick={send}>
          {busy === "sign" ? "Check your wallet…" : busy ? "Sending…" : "Sign and send claim"}
        </button>
      </div>
      {result && (
        <p className={`notice ${result.outcome === "PAYABLE" || result.outcome === "ESCALATED" ? "ok" : "warn"}`}>
          <b>Sent: {result.invoice}.</b>{" "}
          {result.outcome === "PAYABLE"
            ? "It passes every rule; the SendSure agent pays it on its next run."
            : result.outcome === "ESCALATED"
              ? `It passes the rules and waits for a person at ${payer} to co-sign: ${result.reasonText}`
              : `Saved, but it cannot be paid yet: ${result.reasonText}`}
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <h4>Your claims</h4>
      {claims ? <ClaimTable claims={claims} /> : <p className="hint">Loading…</p>}
    </div>
  );
}

/** The payer's side: every claim sent to this org. Payee names come from this browser only. */
export function OrgClaims(props: { org: Address; signer: Signer; payeeName: (ref: Hex) => string; version?: number }) {
  const { org, signer, payeeName, version } = props;
  const [claims, setClaims] = useState<ClaimView[] | null>(null);
  const [error, setError] = useState("");
  const [cosigning, setCosigning] = useState<Hex | null>(null);
  const [cosigned, setCosigned] = useState<Record<string, Hex>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const out = await jsonOrThrow<{ claims: ClaimView[] }>(await authedFetch(signer, `/api/claims?org=${org}`));
      setClaims(out.claims);
    } catch (err) {
      setError(walletErrorText(err));
    }
  }, [org, signer]);

  // After an agent run (the parent bumps `version`) the payer is signed in: show the claims, so a claim that
  // needs a co-sign is right there with its button.
  useEffect(() => {
    if (version) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  async function cosign(c: ClaimView) {
    if (!c.claim_hex) return;
    setError("");
    setCosigning(c.claim_id);
    try {
      const tx = await sendCosign(signer, org, c.claim_hex);
      setCosigned((m) => ({ ...m, [c.claim_id]: tx }));
    } catch (err) {
      const text = walletErrorText(err);
      setError(
        /insufficient funds|gas/i.test(text)
          ? "Your wallet needs a little testnet USDC for gas: faucet.circle.com (Arc testnet)."
          : text,
      );
    } finally {
      setCosigning(null);
    }
  }

  const cosignButton = (c: ClaimView) => {
    const needs = c.status === "open" && (c.agent_action === "escalate" || c.last_outcome === "ESCALATED");
    if (cosigned[c.claim_id]) {
      return (
        <div className="hint">
          Co-signed (<a href={explorerTx(cosigned[c.claim_id]!)}>tx</a>).{c.status === "open" && " Run the agent to pay it (autopilot does it by itself)."}
        </div>
      );
    }
    if (!needs || !c.claim_hex) return null;
    return (
      <div style={{ marginTop: 6 }}>
        <button className="btn secondary" disabled={cosigning !== null} onClick={() => void cosign(c)}>
          {cosigning === c.claim_id ? "Check your wallet…" : "Co-sign this claim"}
        </button>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 900, marginTop: 20 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Claims</h3>
        <button className="linkish" onClick={() => void load()}>
          {claims ? "Refresh" : "Show claims (sign in)"}
        </button>
      </div>
      {claims && <ClaimTable claims={claims} payeeName={payeeName} action={cosignButton} />}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
