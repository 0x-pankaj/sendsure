"use client";

import { useState } from "react";
import { CONTACT_URL } from "../lib/contact";

/** "Get set up": a team that wants help leaves a way to reach them. Nothing is sent until they press the button. */
export function GetSetUp({ source, title }: { source: string; title?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ team: "", contact: "", paysIn: "", payees: "", nextPayout: "", note: "", consent: false });
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...f,
          payees: f.payees.trim() ? Number.parseInt(f.payees, 10) : undefined,
          source,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  if (state === "sent")
    return (
      <div className="notice ok" style={{ marginTop: 24 }}>
        <p>
          <b>Thanks, we&apos;ll be in touch</b>, usually the same day. Want it faster? <a href={CONTACT_URL}>Message us</a>.
        </p>
      </div>
    );

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>{title ?? "Want help running your next payout through SendSure?"}</h3>
      <p className="hint">
        We set it up with you on a 20-minute call: your payout file, your contractors proving their addresses, one rehearsal
        payout on Arc testnet. Free.
      </p>
      {!open ? (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setOpen(true)}>
            Get set up
          </button>
          <a className="btn secondary" href={CONTACT_URL}>
            Message us
          </a>
        </div>
      ) : (
        <form onSubmit={send} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label>
              Team or company
              <input required maxLength={80} value={f.team} onChange={set("team")} style={field} />
            </label>
            <label>
              Email, Telegram or a link to reach you
              <input required maxLength={120} value={f.contact} onChange={set("contact")} style={field} />
            </label>
            <label>
              You pay in (token and chain)
              <input maxLength={80} placeholder="USDC on Base" value={f.paysIn} onChange={set("paysIn")} style={field} />
            </label>
            <label>
              How many people you pay
              <input inputMode="numeric" maxLength={6} value={f.payees} onChange={set("payees")} style={field} />
            </label>
            <label>
              Your next payout (roughly)
              <input maxLength={40} placeholder="end of October" value={f.nextPayout} onChange={set("nextPayout")} style={field} />
            </label>
          </div>
          <label>
            Anything else (optional)
            <textarea maxLength={500} value={f.note} onChange={set("note")} style={{ ...field, minHeight: 70, fontFamily: "inherit" }} />
          </label>
          <label style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={f.consent} onChange={set("consent")} required style={{ marginTop: 5 }} />
            <span>
              SendSure may contact me about setting this up. We keep only what you typed here; see{" "}
              <a href="/data">what we store</a>.
            </span>
          </label>
          <div className="row">
            <button className="btn" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Send"}
            </button>
            <button className="btn secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

const field: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: 8,
  font: "inherit",
  fontWeight: 400,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--ink)",
};
