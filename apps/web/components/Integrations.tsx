"use client";

import { useCallback, useState } from "react";
import type { Address } from "viem";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

interface KeyRow {
  id: string;
  label: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const when = (unix: number | null) => (unix ? new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ") : "never");

/** Connect the books: an integration key for the SendSure Odoo add-on (shown once, stored as a hash). */
export function Integrations(props: { org: Address; signer: Signer }) {
  const { org, signer } = props;
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setKeys((await jsonOrThrow<{ keys: KeyRow[] }>(await authedFetch(signer, `/api/org/keys?org=${org}`))).keys);
    } catch {
      setKeys([]);
    }
  }, [org, signer]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const out = await jsonOrThrow<{ key: string; label: string }>(
        await authedFetch(signer, "/api/org/keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org, label: "Odoo" }),
        }),
      );
      setCreated(out);
      setCopied(false);
      await load();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      await jsonOrThrow(
        await authedFetch(signer, "/api/org/keys", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ org, id }),
        }),
      );
      await load();
    } catch (err) {
      setError(walletErrorText(err));
    }
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const active = (keys ?? []).filter((k) => !k.revoked_at);

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3>Connect your books (Odoo)</h3>
      <p className="hint">
        The SendSure add-on for Odoo 19 sends your posted vendor bills here and records each payment back in Odoo, exactly, with
        the Arc transaction in the memo. Odoo will only trust a vendor wallet that the vendor proved in SendSure. The key can send
        bills and read their status; it can never approve, co-sign or change your rules.
      </p>
      {created && (
        <div className="notice">
          <p>
            <b>Your Odoo key</b> (copy it now; SendSure keeps only a hash and cannot show it again):
          </p>
          <p className="mono" style={{ wordBreak: "break-all" }}>
            {created.key}
          </p>
          <button
            className="btn secondary"
            onClick={() => void navigator.clipboard.writeText(created.key).then(() => setCopied(true), () => undefined)}
          >
            {copied ? "Copied" : "Copy key"}
          </button>
          <p className="hint">
            In Odoo: Invoicing → Configuration → Settings → SendSure. Server <span className="mono">{origin}</span>, org{" "}
            <span className="mono">{org}</span>, and this key. Then on each vendor, paste their SendSure invite link.
          </p>
        </div>
      )}
      <div className="row">
        <button className="btn" disabled={busy} onClick={() => void create()}>
          {busy ? "Creating…" : "Create an Odoo key"}
        </button>
        {keys === null && (
          <button className="linkish" onClick={() => void load()}>
            Show keys
          </button>
        )}
      </div>
      {error && <p className="notice">{error}</p>}
      {keys !== null && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          {active.length === 0 ? (
            <p className="hint">No active keys.</p>
          ) : (
            <table style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td>{when(k.created_at)}</td>
                    <td>{when(k.last_used_at)}</td>
                    <td>
                      <button className="linkish" onClick={() => void revoke(k.id)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <p className="hint">
        Add-on and setup guide:{" "}
        <a href="https://github.com/0x-pankaj/sendsure/tree/main/integrations/odoo">integrations/odoo</a>.
      </p>
    </div>
  );
}
