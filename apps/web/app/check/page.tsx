"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { checkPayout, checkedRowsToRecords, parsePayoutCsv, toCsv, type Action, type CheckedRow } from "@sendsure/core";
import { EXAMPLE_CURRENT, EXAMPLE_LAST } from "../../lib/examples";
import { Help } from "../../components/Help";
import { GetSetUp } from "../../components/GetSetUp";
import { ping } from "../../lib/ping";

const ORDER = { STOP: 0, REVIEW: 1, PAY: 2 } as const;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

function readFile(file: File): Promise<string> {
  return file.text();
}

interface ReviewLine {
  line: number;
  rules: Action;
  model: Action | null;
  action: Action;
  reason: string;
  stricter: boolean;
}
interface Review {
  model: string;
  summary: string;
  lines: ReviewLine[];
}

export default function CheckPage() {
  const [current, setCurrent] = useState("");
  const [last, setLast] = useState("");

  // /check?example opens with the example files loaded (a one-click demo for reviewers).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("example")) {
      setCurrent(EXAMPLE_CURRENT);
      setLast(EXAMPLE_LAST);
    }
  }, []);

  const result = useMemo(() => {
    if (!current.trim()) return null;
    const cur = parsePayoutCsv(current);
    const prev = last.trim() ? parsePayoutCsv(last) : { rows: [], warnings: [] as string[] };
    const checked = checkPayout(cur.rows, prev.rows);
    const rows = [...checked.rows].sort((a, b) => ORDER[a.action] - ORDER[b.action] || a.line - b.line);
    return { ...checked, rows, parsed: { current: cur.rows, last: prev.rows }, warnings: [...cur.warnings, ...prev.warnings.map((w) => `Last payout: ${w}`)] };
  }, [current, last]);

  // The agent's review (optional, opt-in): sent to SendSure and Claude only when asked, never stored.
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [verdict, setVerdict] = useState<Record<number, "agree" | "disagree">>({});
  const [feedbackSent, setFeedbackSent] = useState(false);
  useEffect(() => {
    setReview(null);
    setVerdict({});
    setFeedbackSent(false);
    setReviewError("");
  }, [current, last]);
  const reviewByLine = useMemo(() => new Map((review?.lines ?? []).map((l) => [l.line, l])), [review]);

  async function askAgent() {
    if (!result) return;
    setReviewing(true);
    setReviewError("");
    try {
      const res = await fetch("/api/check/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.parsed),
      });
      const body = (await res.json().catch(() => ({}))) as Review & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
      setReview(body);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }

  async function sendFeedback() {
    const values = Object.values(verdict);
    const res = await fetch("/api/check/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agree: values.filter((v) => v === "agree").length, disagree: values.filter((v) => v === "disagree").length }),
    }).catch(() => null);
    if (res?.ok) setFeedbackSent(true);
  }

  // Anonymous count of checks run (nothing about the file leaves the browser). The example file is not counted.
  const counted = useRef("");
  useEffect(() => {
    if (!result || !result.rows.length || current === EXAMPLE_CURRENT) return;
    const key = `${current.length}:${result.rows.length}`;
    if (counted.current === key) return;
    counted.current = key;
    ping("check_run");
  }, [result, current]);

  function download() {
    if (!result) return;
    const blob = new Blob([toCsv(checkedRowsToRecords(result.rows))], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payout-checked.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h1>Check your payout before you send it</h1>
      <p className="lede">
        Every row is compared with the address you paid last time and with the rest of the list. It catches changed
        wallets, look-alike addresses (address poisoning), duplicates and unusual amounts. Your contractors do not need to
        do anything.
      </p>
      <p className="privacy">
        Your files never leave this browser and are never stored. We only count, anonymously, that a check ran. If you ask
        the agent to review a run, that list goes to SendSure and to Claude (Anthropic) for the review only, and is not stored.
      </p>

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <label htmlFor="current">This payout (CSV)</label>
          <input id="current-file" type="file" accept=".csv,text/csv" onChange={async (e) => e.target.files?.[0] && setCurrent(await readFile(e.target.files[0]))} />
          <textarea id="current" aria-label="This payout CSV" placeholder="payee,address,amount,invoice" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <p className="hint">Columns are detected: payee/name, address/wallet/receiver, amount, invoice/reference. Safe CSV-airdrop files work too.</p>
        </div>
        <div className="card">
          <label htmlFor="last">Last payout (CSV, optional but recommended)</label>
          <input id="last-file" type="file" accept=".csv,text/csv" onChange={async (e) => e.target.files?.[0] && setLast(await readFile(e.target.files[0]))} />
          <textarea id="last" aria-label="Last payout CSV" placeholder="payee,address,amount" value={last} onChange={(e) => setLast(e.target.value)} />
          <p className="hint">Without it, every payee counts as new.</p>
        </div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn secondary" type="button" onClick={() => { setCurrent(EXAMPLE_CURRENT); setLast(EXAMPLE_LAST); }}>Load example</button>
        <button className="btn" type="button" onClick={download} disabled={!result}>Download checked list</button>
      </div>

      {result && (
        <>
          <div className="summary" aria-live="polite">
            {(["STOP", "REVIEW", "PAY"] as const).map((a) => (
              <div className="card" key={a}>
                <span className={`chip ${a}`}>{a}</span>
                <b>{result.summary.byAction[a]}</b>
                <span className="hint">rows · {fmt(result.summary.amountByAction[a])} total</span>
              </div>
            ))}
          </div>
          {result.warnings.length > 0 && (
            <ul className="hint">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="card" style={{ marginTop: 14 }}>
            <b>Ask the agent to review this run</b>
            <p className="hint">
              SendSure&apos;s agent runs the same rules, then Claude reads every line for what rules miss: amounts out of line with
              the payee&apos;s history, the same invoice twice, a reference that does not fit the payee. It can only make a line
              stricter. Nothing is paid. Tell us where you agree; we keep only anonymous counts.
            </p>
            <button className="btn" type="button" onClick={() => void askAgent()} disabled={reviewing || !!review || result.rows.length > 100}>
              {reviewing ? "The agent is reading your run…" : review ? "Reviewed" : "Review with Claude"}
            </button>
            {result.rows.length > 100 && <p className="hint">The review takes up to 100 rows at a time.</p>}
            {reviewError && <p className="notice">{reviewError}</p>}
            {review && (
              <p style={{ marginTop: 10 }}>
                <b>{review.summary}</b>{" "}
                <span className="hint">
                  ({review.lines.filter((l) => l.stricter).length} line(s) made stricter than the rules · read by {review.model})
                </span>
              </p>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Action</th><th>Payee</th><th>Address</th><th>Amount</th><th>Why</th>{review && <th>Agent</th>}</tr>
              </thead>
              <tbody>
                {result.rows.map((r: CheckedRow) => (
                  <tr key={`${r.line}-${r.address}`}>
                    <td><span className={`chip ${r.action}`}>{r.action}</span><div className="hint">{r.status.replaceAll("_", " ").toLowerCase()}</div></td>
                    <td>{r.payee}<div className="hint">line {r.line}{r.reference ? ` · ${r.reference}` : ""}</div></td>
                    <td className="mono" title={r.address}>{short(r.address)}</td>
                    <td>{r.amount === null ? "—" : fmt(r.amount)}</td>
                    <td>
                      {r.explanation}
                      {r.flags.length > 0 && <div className="hint">{r.flags.join(" · ").replaceAll("_", " ").toLowerCase()}</div>}
                    </td>
                    {review && (
                      <td style={{ minWidth: 220 }}>
                        {reviewByLine.get(r.line) ? (
                          <>
                            <span className={`chip ${reviewByLine.get(r.line)!.action}`}>{reviewByLine.get(r.line)!.action}</span>
                            {reviewByLine.get(r.line)!.stricter && <span className="hint"> stricter than the rules</span>}
                            <div>{reviewByLine.get(r.line)!.reason}</div>
                            {!feedbackSent && (
                              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                                {(["agree", "disagree"] as const).map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    className={verdict[r.line] === v ? "btn" : "btn secondary"}
                                    style={{ padding: "2px 10px" }}
                                    onClick={() => setVerdict((old) => ({ ...old, [r.line]: v }))}
                                  >
                                    {v === "agree" ? "Agree" : "Disagree"}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="hint">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {review && Object.keys(verdict).length > 0 && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn secondary" type="button" disabled={feedbackSent} onClick={() => void sendFeedback()}>
                {feedbackSent ? "Thank you" : `Send my verdict on ${Object.keys(verdict).length} line(s)`}
              </button>
              <span className="hint">Only the number of lines you agreed and disagreed with.</span>
            </div>
          )}
        </>
      )}
      <GetSetUp source="check" title="Want this before every payout, enforced by a contract?" />
      <Help topic="the payout check" />
    </>
  );
}
