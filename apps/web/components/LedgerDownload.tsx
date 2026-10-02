"use client";

import { useState } from "react";
import { ping } from "../lib/ping";
import { LEDGER_FORMATS, toLedger, toStatementCsv, type LedgerFormat, type LedgerInput } from "@sendsure/core";

/** What the books API returns (amounts as strings); names are added by the caller, in the browser. */
export interface BooksData {
  org: string;
  treasury: string;
  payments: {
    date: string;
    payeeRef: string;
    invoice: string;
    amount: string;
    txHash: string;
    claimId: string;
    decisionHash: string;
    payout: string;
  }[];
  balances: { day: string; amount: string; block: string }[];
}

export function ledgerInput(data: BooksData, title: string, payeeName: (ref: string) => string): LedgerInput {
  return {
    title,
    org: data.org,
    treasury: data.treasury,
    payments: data.payments.map((p) => ({ ...p, payee: payeeName(p.payeeRef), amount: BigInt(p.amount) })),
    balances: data.balances.map((b) => ({ ...b, amount: BigInt(b.amount) })),
  };
}

const HINT: Record<LedgerFormat, string> = {
  beancount: "passes bean-check",
  hledger: "passes hledger check --strict",
  journal: "debits and credits, for any ledger or a spreadsheet",
  statement: "date, amount, payee, reference: for tools that reconcile from a statement",
};

/** The same books in four formats. The chain is read once; every file is built in the browser. */
export function LedgerDownload(props: { load: () => Promise<LedgerInput>; fileBase: string; disabled?: boolean }) {
  const [busy, setBusy] = useState<LedgerFormat | null>(null);
  const [input, setInput] = useState<LedgerInput | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function download(format: LedgerFormat) {
    setError("");
    setNote("");
    setBusy(format);
    try {
      const data = input ?? (await props.load());
      setInput(data);
      const f = LEDGER_FORMATS[format];
      const url = URL.createObjectURL(new Blob([toLedger(format, data)], { type: f.mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${props.fileBase}.${f.extension}`;
      ping("books_download");
      a.click();
      URL.revokeObjectURL(url);
      const beyond = format === "statement" ? toStatementCsv(data).beyondCents : 0;
      setNote(
        `${data.payments.length} payment(s), ${data.balances.length} balance check(s) from the chain.` +
          (beyond
            ? ` ${beyond} amount(s) have more than two decimals: a tool that keeps cents would round them, so check those by hand.`
            : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="row" style={{ marginTop: 10 }}>
        {(Object.keys(LEDGER_FORMATS) as LedgerFormat[]).map((format) => (
          <button
            key={format}
            className="btn secondary"
            disabled={props.disabled || busy !== null}
            title={HINT[format]}
            onClick={() => void download(format)}
          >
            {busy === format ? "Reading the chain…" : LEDGER_FORMATS[format].label}
          </button>
        ))}
      </div>
      {note && <p className="hint">{note}</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
