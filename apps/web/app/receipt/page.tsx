"use client";

import { useEffect, useState } from "react";
import { explorerAddress, explorerTx } from "@sendsure/chain";

interface Receipt {
  tx: string;
  org: string;
  tier: string;
  payout: string;
  amountUsdc: string;
  time: string;
  block: string;
  claimId: string;
  decisionHash: string;
  addressProof: { tx: string; block: number; kind: string } | null;
  anchor: { seq: number; tx: string } | null;
}

/** /receipt?tx=0x… A public receipt for one SendSure payment, from on-chain facts only. */
export default function ReceiptPage() {
  const [r, setR] = useState<Receipt | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const tx = new URLSearchParams(window.location.search).get("tx") ?? "";
    fetch(`/api/receipt?tx=${encodeURIComponent(tx)}`)
      .then(async (res) => {
        const out = (await res.json()) as Receipt & { error?: string };
        if (res.ok) setR(out);
        else setError(out.error ?? `The server answered ${res.status}.`);
      })
      .catch(() => setError("Could not load the receipt."));
  }, []);

  return (
    <>
      <h1>Payment receipt</h1>
      {error && <p className="notice">{error}</p>}
      {!r && !error && <p className="hint">Reading the chain…</p>}
      {r && (
        <div className="card" style={{ maxWidth: 760 }}>
          <p style={{ fontSize: "1.2rem", marginTop: 0 }}>
            <b>{r.amountUsdc} USDC</b> paid on {new Date(r.time).toUTCString()}
            {r.tier === "sandbox" && (
              <span className="chip STOP" style={{ marginLeft: 8 }}>
                sandbox
              </span>
            )}
          </p>
          <dl className="facts">
            <dt>Paid to</dt>
            <dd>
              <a className="mono" href={explorerAddress(r.payout)}>
                {r.payout}
              </a>
            </dd>
            <dt>The payee proved it</dt>
            <dd>
              {r.addressProof ? (
                <>
                  yes, by signing with this address (
                  <a href={explorerTx(r.addressProof.tx)}>
                    {r.addressProof.kind} at block {r.addressProof.block}
                  </a>
                  )
                </>
              ) : (
                "not found in the index yet"
              )}
            </dd>
            <dt>By</dt>
            <dd>
              SendSure org{" "}
              <a className="mono" href={explorerAddress(r.org)}>
                {r.org}
              </a>
              , inside its on-chain rules
            </dd>
            <dt>Claim (signed by the payee)</dt>
            <dd className="mono">{r.claimId}</dd>
            <dt>Agent decision</dt>
            <dd>
              <span className="mono">{r.decisionHash}</span>
              <div className="hint">
                {r.anchor ? (
                  <>
                    in the org&apos;s decision log, anchored on-chain (
                    <a href={explorerTx(r.anchor.tx)}>anchor #{r.anchor.seq}</a>)
                  </>
                ) : (
                  "not anchored yet"
                )}
              </div>
            </dd>
            <dt>Transaction</dt>
            <dd>
              <a className="mono" href={explorerTx(r.tx)}>
                {r.tx}
              </a>{" "}
              (block {r.block})
            </dd>
          </dl>
          <p className="hint">Invoice numbers and the agent&apos;s reasons are private to the payer and payee.</p>
        </div>
      )}
    </>
  );
}
