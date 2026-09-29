"use client";

import { useEffect, useMemo, useState } from "react";
import { checkPayout, checkedRowsToRecords, parsePayoutCsv, toCsv, type CheckedRow } from "@sendsure/core";
import { EXAMPLE_CURRENT, EXAMPLE_LAST } from "../../lib/examples";
import { Help } from "../../components/Help";

const ORDER = { STOP: 0, REVIEW: 1, PAY: 2 } as const;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

function readFile(file: File): Promise<string> {
  return file.text();
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
    return { ...checked, rows, warnings: [...cur.warnings, ...prev.warnings.map((w) => `Last payout: ${w}`)] };
  }, [current, last]);

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
      <p className="privacy">Your files never leave this browser. Nothing is uploaded or stored.</p>

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
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Action</th><th>Payee</th><th>Address</th><th>Amount</th><th>Why</th></tr>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Help topic="the payout check" />
    </>
  );
}
