"use client";

import { useEffect, useState } from "react";
import { explorerAddress } from "@sendsure/chain";

interface Status {
  chain: { name: string; id: number; latestBlock: string | null };
  database: string;
  indexer: { block: number; updatedAt: number; behindBlocks: number | null } | null;
  keys: Record<string, { address: string; usdc: string | null }>;
  contracts: Record<string, string>;
  commit: string | null;
}

const LABEL: Record<string, string> = {
  relayer: "Relayer (pays gas for payee signatures; no contract role)",
  serverAgent: "Server agent (opens invites; settles when asked)",
  circleAgentWallet: "Circle agent wallet (settles and anchors via the Circle CLI)",
};

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/status")
      .then(async (r) => (r.ok ? setS((await r.json()) as Status) : setError(`The server answered ${r.status}.`)))
      .catch(() => setError("Could not reach the server."));
  }, []);
  const ok = (good: boolean) => <span className={`chip ${good ? "PAY" : "STOP"}`}>{good ? "OK" : "PROBLEM"}</span>;

  return (
    <>
      <h1>Status</h1>
      {error && <p className="notice">{error}</p>}
      {!s && !error && <p className="hint">Checking…</p>}
      {s && (
        <div className="card" style={{ maxWidth: 900 }}>
          <dl className="facts">
            <dt>Chain</dt>
            <dd>
              {ok(Boolean(s.chain.latestBlock))} {s.chain.name} (id {s.chain.id}), block {s.chain.latestBlock ?? "?"}
            </dd>
            <dt>Database</dt>
            <dd>{ok(s.database === "ok")} Cloudflare D1</dd>
            <dt>Indexer</dt>
            <dd>
              {ok(Boolean(s.indexer) && (s.indexer?.behindBlocks ?? 0) < 20_000)}{" "}
              {s.indexer
                ? `block ${s.indexer.block}, ${s.indexer.behindBlocks ?? "?"} behind (indexes when the dashboard is opened)`
                : "not run yet"}
            </dd>
            {Object.entries(s.keys).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{LABEL[k] ?? k}</dt>
                <dd>
                  {ok(Number(v.usdc ?? 0) > 0.05)}{" "}
                  <a className="mono" href={explorerAddress(v.address)}>
                    {v.address}
                  </a>
                  : {v.usdc ?? "?"} USDC for gas
                </dd>
              </div>
            ))}
            {Object.entries(s.contracts).map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>
                  <a className="mono" href={explorerAddress(v)}>
                    {v}
                  </a>
                </dd>
              </div>
            ))}
            <dt>Build</dt>
            <dd className="mono">{s.commit ?? "unknown"}</dd>
          </dl>
        </div>
      )}
    </>
  );
}
