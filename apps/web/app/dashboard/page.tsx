"use client";

import { useEffect, useState } from "react";
import { explorerAddress, explorerTx } from "@sendsure/chain";

type Tier = "external" | "first-party" | "sandbox";
interface Bucket {
  orgs: number;
  payeesBound: number;
  payments: number;
  paidUsdc: string;
  escalations: number;
  refusals: number;
  cosigns: number;
  anchors: number;
}
interface Stats {
  tiers: Record<Tier, Bucket>;
  recentPayments: { tx: string; block: number; org: string; payout: string; amountUsdc: string; tier: Tier }[];
  indexer: { block?: number; updatedAt?: number; error?: string };
  paidCalls?: {
    external: { calls: number; usdc: string; payers: number };
    firstParty: { calls: number; usdc: string; payers: number };
    byEndpoint: Record<string, number>;
  };
}

const TIERS: { key: Tier; title: string; note: string }[] = [
  { key: "external", title: "External", note: "Orgs owned by people outside the team. The only numbers we call traction." },
  { key: "first-party", title: "First-party", note: "Our own production orgs: demos and dogfooding." },
  { key: "sandbox", title: "Sandbox", note: "Test orgs (our tests, test wallets). Never counted." },
];

const ROWS: { key: keyof Bucket; label: string }[] = [
  { key: "orgs", label: "Orgs" },
  { key: "payeesBound", label: "Payees who proved their address" },
  { key: "payments", label: "Payments settled" },
  { key: "paidUsdc", label: "USDC paid" },
  { key: "escalations", label: "Escalated to a person" },
  { key: "refusals", label: "Refused by the contract" },
  { key: "cosigns", label: "Human co-signs" },
  { key: "anchors", label: "Decision-log anchors" },
];

export default function Dashboard() {
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/stats")
      .then(async (r) => (r.ok ? setData((await r.json()) as Stats) : setError(`The server answered ${r.status}.`)))
      .catch(() => setError("Could not load the numbers."));
  }, []);

  return (
    <>
      <h1>SendSure on Arc testnet, in numbers</h1>
      <p className="lede">
        Counted only from on-chain events of the SendSure contracts, so every number links to a transaction. Sandbox activity is
        shown but never counted as traction.
      </p>
      {error && <p className="notice">{error}</p>}
      {!data && !error && <p className="hint">Reading the chain…</p>}
      {data && (
        <>
          <div className="table-wrap" style={{ maxWidth: 900 }}>
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th></th>
                  {TIERS.map((t) => (
                    <th key={t.key}>{t.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    {TIERS.map((t) => (
                      <td key={t.key} className={t.key === "external" ? "" : "hint"}>
                        {data.tiers[t.key][r.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="hint" style={{ maxWidth: 900 }}>
            {TIERS.map((t) => (
              <li key={t.key}>
                <b>{t.title}:</b> {t.note}
              </li>
            ))}
          </ul>
          {data.paidCalls && (
            <>
              <h2>Agents paying SendSure per call</h2>
              <p className="hint" style={{ maxWidth: 900 }}>
                Other agents buy payee checks with USDC nanopayments (x402 over Circle Gateway): $0.001 to verify a payee, $0.005 to
                check a payout file. <a href="/api/x402">Catalog</a>.
              </p>
              <div className="table-wrap" style={{ maxWidth: 900 }}>
                <table style={{ minWidth: 480 }}>
                  <thead>
                    <tr>
                      <th></th>
                      <th>External</th>
                      <th>First-party</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Paid calls</td>
                      <td>{data.paidCalls.external.calls}</td>
                      <td className="hint">{data.paidCalls.firstParty.calls}</td>
                    </tr>
                    <tr>
                      <td>USDC earned</td>
                      <td>{data.paidCalls.external.usdc}</td>
                      <td className="hint">{data.paidCalls.firstParty.usdc}</td>
                    </tr>
                    <tr>
                      <td>Paying agents</td>
                      <td>{data.paidCalls.external.payers}</td>
                      <td className="hint">{data.paidCalls.firstParty.payers}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
          <h2>Latest payments</h2>
          {data.recentPayments.length === 0 ? (
            <p className="hint">None yet.</p>
          ) : (
            <div className="table-wrap" style={{ maxWidth: 900 }}>
              <table style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Amount</th>
                    <th>Paid to</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentPayments.map((p) => (
                    <tr key={p.tx}>
                      <td>
                        <span className={`chip ${p.tier === "external" ? "PAY" : p.tier === "first-party" ? "REVIEW" : "STOP"}`}>
                          {p.tier}
                        </span>
                      </td>
                      <td>{p.amountUsdc} USDC</td>
                      <td className="mono">
                        <a href={explorerAddress(p.payout)}>{`${p.payout.slice(0, 6)}…${p.payout.slice(-4)}`}</a>
                      </td>
                      <td>
                        <a href={`/receipt?tx=${p.tx}`}>receipt</a> · <a href={explorerTx(p.tx)}>tx</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">
            Indexed up to block {data.indexer.block ?? "?"}. <a href="/status">System status</a>
          </p>
        </>
      )}
    </>
  );
}
