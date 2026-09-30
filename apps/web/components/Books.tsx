"use client";

import type { Address, Hex } from "viem";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { type Signer } from "../lib/wallet";
import { LedgerDownload, ledgerInput, type BooksData } from "./LedgerDownload";

/** 5. Books: every payment reconciled to the chain; payee names are filled in here, in the browser. */
export function Books(props: { org: Address; orgName: string; signer: Signer; payeeName: (ref: Hex) => string }) {
  const { org, orgName, signer, payeeName } = props;
  const load = async () =>
    ledgerInput(await jsonOrThrow<BooksData>(await authedFetch(signer, `/api/org/books?org=${org}`)), orgName, (ref) =>
      payeeName(ref as Hex),
    );

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>5. Your books</h3>
      <p className="hint">
        Every SendSure payment (its claim, the agent&apos;s decision and the Arc transaction), checked against your
        treasury&apos;s balance on the chain for each payment day. Pick the format your books use; the beancount file passes{" "}
        <span className="mono">bean-check</span> and the hledger journal passes <span className="mono">hledger check</span>.
        Using Odoo? <a href="/books">Payments are recorded there directly</a>.
      </p>
      <LedgerDownload load={load} fileBase={`sendsure-${org.slice(0, 8)}`} />
    </div>
  );
}
