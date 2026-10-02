"use client";

import { useState } from "react";
import type { Address } from "viem";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

interface NotifyView {
  set: boolean;
  kind?: "discord" | "slack" | null;
  url?: string;
  lastError?: string | null;
}

/** Where SendSure tells the team that a claim arrived, a co-sign is waiting, or a payment went out. */
export function Notify({ org, signer }: { org: Address; signer: Signer }) {
  const [view, setView] = useState<NotifyView | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(body?: unknown) {
    setError("");
    setBusy(true);
    try {
      const res = body
        ? await authedFetch(signer, "/api/org/notify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        : await authedFetch(signer, `/api/org/notify?org=${org}`);
      setView(await jsonOrThrow<NotifyView>(res));
      if (body) setUrl("");
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>Get notified</h3>
      <p className="hint">
        A message in your Discord or Slack when a payee signs a claim, when a payment waits for your co-sign, and when the agent
        pays. Paste an incoming-webhook URL for a channel (Discord: channel settings → Integrations → Webhooks; Slack: an
        Incoming Webhooks app). Messages carry the invoice number and amount, never payee names.
      </p>
      {!view ? (
        <button className="btn secondary" disabled={busy} onClick={() => void call()}>
          {busy ? "Checking…" : "Set up notifications"}
        </button>
      ) : (
        <>
          {view.set && (
            <p className={view.lastError ? "notice warn" : "notice ok"}>
              Sending to {view.kind === "slack" ? "Slack" : "Discord"} (<span className="mono">{view.url}</span>).
              {view.lastError && ` The last message failed: ${view.lastError}.`}
            </p>
          )}
          <div className="row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              style={{ flex: 1, minWidth: 260, padding: 8, font: "inherit", border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg)", color: "var(--ink)" }}
            />
            <button className="btn" disabled={busy || !url.trim()} onClick={() => void call({ org, url: url.trim() })}>
              {busy ? "Sending a test…" : view.set ? "Replace" : "Save and send a test"}
            </button>
            {view.set && (
              <button className="btn secondary" disabled={busy} onClick={() => void call({ org, url: null })}>
                Turn off
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
