"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { toBeancount } from "@sendsure/core";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

interface BooksData {
  treasury: Address;
  payments: {
    date: string;
    payeeRef: Hex;
    invoice: string;
    amount: string;
    txHash: Hex;
    claimId: Hex;
    decisionHash: Hex;
    payout: Address;
  }[];
  balances: { day: string; amount: string; block: string }[];
}

/** 5. Books: a beancount file reconciled to the chain; payee names are filled in here, in the browser. */
export function Books(props: { org: Address; orgName: string; signer: Signer; payeeName: (ref: Hex) => string }) {
  const { org, orgName, signer, payeeName } = props;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function download() {
    setError("");
    setNote("");
    setBusy(true);
    try {
      const data = await jsonOrThrow<BooksData>(await authedFetch(signer, `/api/org/books?org=${org}`));
      const text = toBeancount({
        title: orgName,
        org,
        treasury: data.treasury,
        payments: data.payments.map((p) => ({ ...p, payee: payeeName(p.payeeRef), amount: BigInt(p.amount) })),
        balances: data.balances.map((b) => ({ ...b, amount: BigInt(b.amount) })),
      });
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `sendsure-${org.slice(0, 8)}.beancount`;
      a.click();
      URL.revokeObjectURL(url);
      setNote(`${data.payments.length} payment(s), ${data.balances.length} balance check(s) from the chain.`);
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>5. Your books</h3>
      <p className="hint">
        A beancount file with every SendSure payment (its claim, the agent&apos;s decision and the Arc transaction), checked
        against your treasury&apos;s balance on the chain for each payment day. It passes <span className="mono">bean-check</span>
        .
      </p>
      <button className="btn secondary" disabled={busy} onClick={download}>
        {busy ? "Reading the chain…" : "Download books (.beancount)"}
      </button>
      {note && <p className="hint">{note}</p>}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
