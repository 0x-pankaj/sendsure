"use client";

import { useEffect, useState } from "react";
import { getAddress } from "viem";
import { explorerAddress } from "@sendsure/chain";
import { checkPayout, parsePayoutCsv, type CheckedRow } from "@sendsure/core";
import { DemoBooks } from "../../components/DemoBooks";

type Scene = "bind" | "attack" | "change" | "pay" | "inbox";
type InboxClaim = { what: string; invoice: string; amountUsdc: string; contract: string; agent: string; paid: boolean };
type Result = Record<string, string | boolean | null | undefined | InboxClaim[]>;

const KEY = "sendsure.try.session";
function session(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/** A valid look-alike of `address`: same first 4 and last 4 hex characters, different middle (address poisoning). */
function lookAlike(address: string): string {
  const mid = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  return getAddress(`${address.slice(0, 6)}${mid}${address.slice(-4)}`.toLowerCase());
}

const Link = ({ href, children }: { href?: string | null; children: React.ReactNode }) =>
  href ? <a href={href}>{children}</a> : null;

export default function TryPage() {
  const [sid, setSid] = useState("");
  const [results, setResults] = useState<Partial<Record<Scene, Result>>>({});
  const [busy, setBusy] = useState<Scene | "">("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<CheckedRow[] | null>(null);

  useEffect(() => {
    const id = session();
    setSid(id);
    // Restore the steps this browser already ran.
    fetch(`/api/try?session=${id}`)
      .then((r) => r.json() as Promise<{ scenes?: Partial<Record<Scene, Result>> }>)
      .then((d) => d.scenes && setResults(d.scenes))
      .catch(() => undefined);
  }, []);

  async function run(scene: Scene) {
    setError("");
    setBusy(scene);
    try {
      const res = await fetch("/api/try", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sid, scene }),
      });
      const out = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
      setResults((r) => ({ ...r, [scene]: out }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  }

  function runPayoutCheck() {
    const payout = String(results.bind?.payout ?? "");
    const last = parsePayoutCsv(`payee,address,amount\nDemo payee,${payout},0.05`).rows;
    const current = parsePayoutCsv(`payee,address,amount\nDemo payee,${lookAlike(payout)},0.05`).rows;
    setCheck(checkPayout(current, last).rows);
  }


  const step = (scene: Scene, label: string, needs?: Scene) => (
    <button className="btn" disabled={busy !== "" || !sid || (needs ? !results[needs] : false)} onClick={() => run(scene)}>
      {busy === scene ? "Working on Arc testnet…" : results[scene] ? "Done ✓" : label}
    </button>
  );

  const bound = results.bind;
  return (
    <>
      <h1>Try SendSure in two minutes, no wallet needed</h1>
      <p className="lede">
        SendSure plays everyone here: the payee, an attacker and the payer&apos;s approver. Every step is a real transaction on
        Arc testnet, on a sandbox org that never counts as traction.
      </p>

      <ol className="steps">
        <li className={bound ? "done" : ""}>
          <h3>1. A payee proves their address</h3>
          <p className="hint">
            The payer sends an invite. The payee signs once with their wallet; SendSure&apos;s relayer pays the gas.
          </p>
          {step("bind", "Invite a payee and let them sign")}
          {bound && (
            <p className="notice ok">
              Payout address{" "}
              <a className="mono" href={explorerAddress(String(bound.payout))}>
                {String(bound.payout)}
              </a>
              . {String(bound.says)} <Link href={bound.bindTx as string}>proof tx</Link>
            </p>
          )}
        </li>

        <li className={results.attack ? "done" : !bound ? "off" : ""}>
          <h3>2. A look-alike address, and an attacker</h3>
          <p className="hint">
            Address poisoning: a scammer plants an address that starts and ends like the real one. First, the free payout check on
            a list that contains it. Then the attacker signs a claim for the payee&apos;s work and tries to get it paid.
          </p>
          <div className="row">
            <button className="btn secondary" disabled={!bound} onClick={runPayoutCheck}>
              Run the payout check
            </button>
            {step("attack", "Let the attacker try", "bind")}
          </div>
          {check && (
            <p className="notice warn">
              {check.map((r) => (
                <span key={r.line}>
                  <b>{r.action}</b> <span className="mono">{`${r.address.slice(0, 10)}…${r.address.slice(-6)}`}</span>:{" "}
                  {r.explanation}
                </span>
              ))}
            </p>
          )}
          {results.attack && (
            <p className="notice ok">
              {String(results.attack.says)} <Link href={results.attack.refusedTx as string}>the refusal, on-chain</Link>
            </p>
          )}
        </li>

        <li className={results.change ? "done" : !bound ? "off" : ""}>
          <h3>3. &ldquo;Please pay my new wallet&rdquo;</h3>
          <p className="hint">The attacker now tries to move the payee&apos;s payouts to their own wallet.</p>
          {step("change", "Try to change the wallet", "bind")}
          {results.change && (
            <div className="notice ok">
              <p>
                <b>Refused.</b> SendSure: &ldquo;{String(results.change.relayerSays)}&rdquo; The contract:{" "}
                {String(results.change.contractSays)}.
              </p>
              <p>{String(results.change.says)}</p>
            </div>
          )}
        </li>

        <li className={results.pay ? "done" : !bound ? "off" : ""}>
          <h3>4. A real payment</h3>
          <p className="hint">
            The payee signs a claim for 0.05 USDC. The agent checks it with the contract&apos;s own rules: it is a first payment
            to a new address, so it waits for a person. The demo approver co-signs; the agent pays.
          </p>
          {step("pay", "Send the claim and run the agent", "bind")}
          {results.pay && (
            <div className="notice ok">
              <p>Claim: {String(results.pay.stored)}</p>
              <p>Agent, first run: {String(results.pay.firstRun)}</p>
              <p>
                Approver co-signed: <Link href={results.pay.cosignTx as string}>tx</Link>
              </p>
              <p>Agent, second run: {String(results.pay.secondRun)}</p>
              <p>
                <Link href={results.pay.receipt as string}>Receipt</Link> ·{" "}
                <Link href={results.pay.settleTx as string}>payment tx</Link>
              </p>
            </div>
          )}
        </li>

        <li className={results.inbox ? "done" : !results.pay ? "off" : ""}>
          <h3>5. An inbox full of tricks</h3>
          <p className="hint">
            The payee now sends three messy claims: the same work billed again under a new invoice number, a large claim with no
            description, and a &ldquo;new wallet&rdquo; request with a hidden instruction to the AI. The agent reviews them with
            Claude.
          </p>
          {step("inbox", "Send the inbox and run the agent", "pay")}
          {results.inbox && (
            <div className="notice ok">
              <p className="hint">{String(results.inbox.planner)}</p>
              {(results.inbox.claims as InboxClaim[]).map((c) => (
                <p key={c.invoice}>
                  <b>{c.what}</b> ({c.amountUsdc} USDC): {c.paid ? "PAID" : "not paid"}. Agent: {c.agent}
                </p>
              ))}
              <p>
                <b>{String(results.inbox.guarantee)}</b>
              </p>
            </div>
          )}
        </li>

        <li className={!results.pay ? "off" : ""}>
          <h3>6. The books</h3>
          <p className="hint">
            Every demo payment (claim, decision hash, Arc tx), reconciled to the treasury&apos;s balance on-chain, in the
            format your books use. With <a href="/books">Odoo</a>, payments are recorded there directly.
          </p>
          {results.pay ? <DemoBooks /> : <p className="hint">Finish step 4 to download the books.</p>}
        </li>
      </ol>

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <Lookup defaultAddress={String(bound?.payout ?? "")} />
    </>
  );
}

function Lookup(props: { defaultAddress: string }) {
  const [org, setOrg] = useState("");
  useEffect(() => {
    fetch("/api/try")
      .then((r) => r.json() as Promise<{ org?: string }>)
      .then((d) => d.org && setOrg((o) => o || d.org!))
      .catch(() => undefined);
  }, []);
  const [address, setAddress] = useState("");
  const [answer, setAnswer] = useState<string>("");
  useEffect(() => {
    if (props.defaultAddress) setAddress(props.defaultAddress);
  }, [props.defaultAddress]);

  async function ask() {
    setAnswer("Checking…");
    const res = await fetch(`/api/lookup?org=${encodeURIComponent(org)}&address=${encodeURIComponent(address)}`);
    const out = (await res.json()) as { verified?: boolean; state?: string; error?: string; since?: { block: number } };
    setAnswer(
      !res.ok
        ? (out.error ?? "Could not check.")
        : out.verified
          ? `Yes: a payee proved this address for this org (block ${out.since?.block}).`
          : `No: ${out.state === "FROZEN" ? "the payer froze this payee." : "not a proven payee of this org."}`,
    );
  }

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Check any address</h3>
      <p className="hint">Is this address a payee who proved it for this org, right now? Public: no names, no amounts.</p>
      <div className="grid">
        <input
          className="mono"
          placeholder="org 0x…"
          value={org}
          onChange={(e) => setOrg(e.target.value)}
          style={{ padding: 8 }}
        />
        <input
          className="mono"
          placeholder="address 0x…"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ padding: 8 }}
        />
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn secondary" onClick={ask} disabled={!org || !address}>
          Check
        </button>
        <span>{answer}</span>
      </div>
    </div>
  );
}
