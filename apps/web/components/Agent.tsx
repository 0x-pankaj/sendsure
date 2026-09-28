"use client";

import { useState } from "react";
import type { Address, Hex } from "viem";
import { explorerTx } from "@sendsure/chain";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

interface RunDecision {
  claimId: Hex;
  payeeRef: Hex;
  invoiceRef: string;
  amountUsdc: string;
  action: "pay" | "escalate" | "hold" | "close";
  reason: string;
  decisionHash: Hex;
  tx?: { hash: Hex; outcome: string } | null;
  error?: string;
}

interface RunResult {
  runId: string;
  planner: string;
  summary: string;
  decisions: RunDecision[];
  anchor: { txHash: Hex; anchorSeq: number; decisionSeq: number } | null;
  modelError: string | null;
}

const CHIP: Record<RunDecision["action"], [string, string]> = {
  pay: ["PAY", "Pay"],
  escalate: ["REVIEW", "Needs your co-sign"],
  hold: ["STOP", "Held"],
  close: ["STOP", "Closed"],
};

/** "Let the agent pay": one run over every open claim, with its reasons and transactions. */
export function AgentPanel(props: { org: Address; signer: Signer; payeeName: (ref: Hex) => string; onRan: () => void }) {
  const { org, signer, payeeName, onRan } = props;
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState("");

  async function go() {
    setError("");
    setBusy(true);
    try {
      const res = await authedFetch(signer, "/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org }),
      });
      setRun(await jsonOrThrow<RunResult>(res));
      onRan();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>4. Let the agent pay</h3>
      <p className="hint">
        The agent checks every open claim against your rules, holds anything unusual, asks you to co-sign where a person must, and
        pays the rest from your budget. Each decision is logged, its hash goes into the payment, and the log is anchored on Arc.
      </p>
      <button className="btn" disabled={busy} onClick={go}>
        {busy ? "The agent is working…" : "Run the agent now"}
      </button>
      {error && <p className="notice">{error}</p>}
      {run && (
        <div style={{ marginTop: 14 }}>
          <p>
            <b>{run.summary}</b> <span className="hint">({run.planner})</span>
          </p>
          {run.modelError && <p className="hint">The AI review was skipped this time; the rules decided alone.</p>}
          {run.decisions.length > 0 && (
            <div className="table-wrap">
              <table style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {run.decisions.map((d) => {
                    const [chip, label] = d.tx?.outcome === "Settled" ? (["PAY", "Paid"] as [string, string]) : CHIP[d.action];
                    return (
                      <tr key={d.claimId}>
                        <td>{payeeName(d.payeeRef)}</td>
                        <td className="mono">{d.invoiceRef}</td>
                        <td>{d.amountUsdc} USDC</td>
                        <td>
                          <span className={`chip ${chip}`}>{label}</span>
                          <div className="hint">{d.reason}</div>
                          {d.tx && (
                            <div className="hint">
                              <a href={explorerTx(d.tx.hash)}>{d.tx.outcome} on Arc</a>
                            </div>
                          )}
                          {d.error && <div className="hint">Not paid: {d.error}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {run.anchor && (
            <p className="hint">
              Decision log (entries 1–{run.anchor.decisionSeq}) anchored on Arc:{" "}
              <a href={explorerTx(run.anchor.txHash)}>anchor #{run.anchor.anchorSeq}</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
