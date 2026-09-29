"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { formatUsdc } from "@sendsure/chain";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

interface Evidenced {
  value: string;
  quote: string;
}
export interface InvoiceProposal {
  id: string;
  payee_ref: Hex;
  invoice_ref: string;
  amount: string;
  period_start: number;
  period_end: number;
  description: string;
  source: string;
  status: string;
  created_at: number;
  extraction: {
    source?: string;
    fields?: Record<string, string>;
    model?: string;
    evidence?: Record<string, Evidenced | string[]>;
    quoteFoundInInvoice?: Record<string, boolean>;
    warnings?: string[];
  };
}

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);
const FIELDS: [string, string][] = [
  ["invoiceNumber", "Invoice number"],
  ["total", "Total"],
  ["periodStart", "Work from"],
  ["periodEnd", "Work to"],
  ["issuer", "From"],
  ["work", "Work"],
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

/** What the AI read, with the quote each value came from and whether the quote is really in the invoice. */
export function Evidence({ p }: { p: InvoiceProposal }) {
  if (p.source === "odoo") return <FromBooks p={p} />;
  const ev = p.extraction.evidence ?? {};
  const ok = p.extraction.quoteFoundInInvoice ?? {};
  const instructions = (ev.paymentInstructions as string[] | undefined) ?? [];
  return (
    <div>
      <div className="table-wrap">
        <table style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Field</th>
              <th>Read as</th>
              <th>From the invoice</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(([key, label]) => {
              const f = ev[key] as (Evidenced & { currency?: string }) | undefined;
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td>
                    {f?.value || "-"} {f?.currency ?? ""}
                  </td>
                  <td>
                    {f?.quote ? <span className="mono">&ldquo;{f.quote}&rdquo;</span> : "-"}{" "}
                    {f?.quote &&
                      (ok[key] ? (
                        <span title="found word for word in the invoice">✓</span>
                      ) : (
                        <span title="not found in the invoice">⚠ not found</span>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {instructions.length > 0 && (
        <p className="notice warn">
          Payment instructions in the invoice: {instructions.map((i) => `"${i}"`).join("; ")}. SendSure ignores these: it only
          ever pays the payee&apos;s proven address.
        </p>
      )}
      {(p.extraction.warnings ?? []).length > 0 && (
        <ul className="hint">
          {(p.extraction.warnings ?? []).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <p className="hint">
        Read by {p.extraction.model ?? "Claude"} via MeshAPI from {p.source === "image" ? "a photo" : "the pasted text"}.
      </p>
    </div>
  );
}

/** A bill the payer's own books (Odoo) sent: no AI involved, the numbers are the bill's. */
function FromBooks({ p }: { p: InvoiceProposal }) {
  const f = p.extraction.fields ?? {};
  return (
    <div>
      <div className="table-wrap">
        <table style={{ minWidth: 420 }}>
          <tbody>
            <tr>
              <td>Invoice number</td>
              <td>{f.invoiceRef ?? p.invoice_ref}</td>
            </tr>
            <tr>
              <td>Amount</td>
              <td>
                {f.amount} {f.currency}
              </td>
            </tr>
            <tr>
              <td>Dated</td>
              <td>{f.periodStart === f.periodEnd ? f.periodStart : `${f.periodStart} to ${f.periodEnd}`}</td>
            </tr>
            {f.document && (
              <tr>
                <td>Payer&apos;s bill</td>
                <td className="mono">{f.document}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">Sent from the payer&apos;s Odoo. Sign it only if this is your invoice and the amount is right.</p>
    </div>
  );
}

/** The payer's side: read an invoice with AI and send it to the payee to confirm. */
export function AddInvoice(props: { org: Address; signer: Signer; vendors: { name: string; payeeRef: Hex }[] }) {
  const { org, signer, vendors } = props;
  const [payeeRef, setPayeeRef] = useState<Hex | "">(vendors[0]?.payeeRef ?? "");
  const [text, setText] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InvoiceProposal | null>(null);
  const [list, setList] = useState<InvoiceProposal[] | null>(null);
  const nameOf = (ref: Hex) => vendors.find((v) => v.payeeRef.toLowerCase() === ref.toLowerCase())?.name ?? ref.slice(0, 10);
  // The list can grow after this card first rendered: fall back to the first payee, never to nothing.
  const selected: Hex | "" = vendors.some((v) => v.payeeRef === payeeRef) ? payeeRef : (vendors[0]?.payeeRef ?? "");

  const load = useCallback(async () => {
    try {
      setList(
        (await jsonOrThrow<{ proposals: InvoiceProposal[] }>(await authedFetch(signer, `/api/invoices?org=${org}`))).proposals,
      );
    } catch {
      // Shown when the payer asks for it; not an error here.
    }
  }, [org, signer]);

  async function read() {
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const res = await authedFetch(signer, "/api/invoices/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org,
          payeeRef: selected,
          text: text.trim() || undefined,
          image: text.trim() ? undefined : image || undefined,
        }),
      });
      setResult(await jsonOrThrow<InvoiceProposal>(res));
      setText("");
      setImage("");
      await load();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!vendors.length) return null;
  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>6. Add an invoice</h3>
      <p className="hint">
        Paste an invoice or upload a photo of it. Claude (via MeshAPI) reads it and shows where each value came from. The payee
        then checks it and signs the claim themselves; nothing is paid on the AI&apos;s word.
      </p>
      <label htmlFor="inv-payee">From</label>
      <select id="inv-payee" value={selected} onChange={(e) => setPayeeRef(e.target.value as Hex)}>
        {vendors.map((v) => (
          <option key={v.payeeRef} value={v.payeeRef}>
            {v.name}
          </option>
        ))}
      </select>
      <label htmlFor="inv-text" style={{ marginTop: 10 }}>
        Invoice text
      </label>
      <textarea id="inv-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the invoice here…" />
      <p className="hint">
        or a photo (PNG, JPG, WebP):{" "}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => e.target.files?.[0] && setImage(await readAsDataUrl(e.target.files[0]))}
        />
      </p>
      <button className="btn" disabled={busy || !selected || (!text.trim() && !image)} onClick={read}>
        {busy ? "Reading…" : "Read with AI"}
      </button>
      {error && <p className="notice">{error}</p>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <p>
            <b>
              {result.invoice_ref}: {formatUsdc(BigInt(result.amount))} USDC, {day(result.period_start)} to{" "}
              {day(result.period_end)}
            </b>{" "}
            — sent to {nameOf(result.payee_ref)} to confirm.
          </p>
          <Evidence p={result} />
        </div>
      )}
      <p className="hint">
        <button className="linkish" onClick={() => void load()}>
          {list ? "Refresh invoices" : "Show invoices (sign in)"}
        </button>
      </p>
      {list && list.length > 0 && (
        <ul className="hint">
          {list.map((p) => (
            <li key={p.id}>
              {nameOf(p.payee_ref)} · {p.invoice_ref} · {formatUsdc(BigInt(p.amount))} USDC ·{" "}
              {p.status === "proposed"
                ? "waiting for the payee"
                : p.status === "claimed"
                  ? "confirmed and signed by the payee"
                  : "rejected by the payee"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The payee's side: invoices the payer uploaded, to confirm (fills the claim form) or reject. */
export function PayeeInvoices(props: {
  org: Address;
  payeeRef: Hex;
  signer: Signer;
  payer: string;
  onUse: (p: InvoiceProposal) => void;
  version: number;
}) {
  const { org, payeeRef, signer, payer, onUse, version } = props;
  const [items, setItems] = useState<InvoiceProposal[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const out = await jsonOrThrow<{ proposals: InvoiceProposal[] }>(
        await authedFetch(signer, `/api/invoices?org=${org}&ref=${payeeRef}`),
      );
      setItems(out.proposals.filter((p) => p.status === "proposed"));
    } catch {
      setItems([]);
    }
  }, [org, payeeRef, signer]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function reject(p: InvoiceProposal) {
    await authedFetch(signer, "/api/invoices/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org, id: p.id }),
    });
    await load();
  }

  if (!items.length) return null;
  return (
    <div className="notice warn">
      <p>
        <b>
          {payer} sent {items.length} invoice{items.length === 1 ? "" : "s"} for you to confirm.
        </b>{" "}
        Check each one, then sign it as your claim. If it is wrong or not yours, say so.
      </p>
      {items.map((p) => (
        <div key={p.id} style={{ marginTop: 8 }}>
          <p>
            <span className="mono">{p.invoice_ref}</span>: {formatUsdc(BigInt(p.amount))} USDC, {day(p.period_start)} to{" "}
            {day(p.period_end)} {p.description && `(${p.description})`}{" "}
            <button className="linkish" onClick={() => setOpen(open === p.id ? null : p.id)}>
              {open === p.id ? "hide details" : "how it was read"}
            </button>
          </p>
          {open === p.id && <Evidence p={p} />}
          <div className="row">
            <button className="btn secondary" onClick={() => onUse(p)}>
              Use this invoice
            </button>
            <button className="linkish" onClick={() => void reject(p)}>
              Not mine / wrong
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
