"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { explorerTx, formatUsdc } from "@sendsure/chain";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

interface RunDecision {
  model?: { action: string; reason: string; concerns?: string[] } | null;
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
  cash?: { balance: string; allowance: string; available: string; payable: string; waitingCosign: string; shortBy: string };
}

interface Autopilot {
  enabled: boolean;
  lastCheckedAt: number | null;
  lastRunAt: number | null;
  lastSummary: string | null;
}

const when = (unix: number) => new Date(unix * 1000).toLocaleString();

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
  const [auto, setAuto] = useState<Autopilot | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  // Autopilot's state is read once the wallet has a session (after any signed action on this page).
  async function loadAutopilot() {
    try {
      setAuto(await jsonOrThrow<Autopilot>(await authedFetch(signer, `/api/org/autopilot?org=${org}`)));
    } catch {
      // not the owner or an approver: the switch stays hidden
    }
  }
  useEffect(() => {
    setAuto(null);
  }, [org]);

  async function toggleAutopilot(enabled: boolean) {
    setError("");
    setAutoBusy(true);
    try {
      const res = await authedFetch(signer, "/api/org/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, enabled }),
      });
      setAuto(await jsonOrThrow<Autopilot>(res));
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setAutoBusy(false);
    }
  }

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
      void loadAutopilot();
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
      <div className="row">
        <button className="btn" disabled={busy} onClick={go}>
          {busy ? "The agent is working…" : "Run the agent now"}
        </button>
        {auto ? (
          <button className="btn secondary" disabled={autoBusy} onClick={() => void toggleAutopilot(!auto.enabled)}>
            {autoBusy ? "Check your wallet…" : auto.enabled ? "Turn autopilot off" : "Turn autopilot on"}
          </button>
        ) : (
          <button className="btn secondary" disabled={autoBusy} onClick={() => void loadAutopilot()}>
            Autopilot settings
          </button>
        )}
      </div>
      {auto && (
        <p className={`notice ${auto.enabled ? "ok" : "warn"}`}>
          <b>Autopilot is {auto.enabled ? "on" : "off"}.</b>{" "}
          {auto.enabled
            ? "The agent checks your open claims every minute and runs by itself when something changes: a new claim, your co-sign, or funds arriving. It has no extra power: your budget and co-sign rules apply to every run."
            : "The agent runs only when you press the button. Turn autopilot on and it runs by itself when a claim arrives, you co-sign, or funds arrive, always inside your budget and co-sign rules."}
          {auto.lastRunAt && auto.lastRunAt <= Date.now() / 1000 && (
            <>
              {" "}
              Last run by itself: {when(auto.lastRunAt)}. {auto.lastSummary}
            </>
          )}
        </p>
      )}
      {error && <p className="notice">{error}</p>}
      {run && (
        <div style={{ marginTop: 14 }}>
          <p>
            <b>{run.summary}</b> <span className="hint">({run.planner})</span>
          </p>
          {run.modelError && <p className="hint">The AI review was skipped this time; the rules decided alone.</p>}
          {run.cash && (
            <p className={BigInt(run.cash.shortBy) > 0n ? "notice warn" : "hint"}>
              Cash at this run: your wallet can pay {formatUsdc(BigInt(run.cash.available))} USDC right now (balance{" "}
              {formatUsdc(BigInt(run.cash.balance))}, budget allowance {formatUsdc(BigInt(run.cash.allowance))}); {formatUsdc(BigInt(run.cash.payable))}{" "}
              USDC was ready to pay and {formatUsdc(BigInt(run.cash.waitingCosign))} USDC waits for a co-sign.
              {BigInt(run.cash.shortBy) > 0n &&
                ` Short by ${formatUsdc(BigInt(run.cash.shortBy))} USDC: the oldest work was paid first and the rest waits for funds.`}
            </p>
          )}
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
                          {d.model?.concerns && d.model.concerns.length > 0 && (
                            <div className="hint">AI also noticed: {d.model.concerns.join("; ")}</div>
                          )}
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
