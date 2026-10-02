"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  DEFAULT_PERIOD_SECONDS,
  createOrgMessage,
  deployment,
  explorerAddress,
  explorerTx,
  formatUsdc,
  inviteBatchHash,
  openInvitesMessage,
  readMandate,
  readPayee,
  usdc,
  usdcPermitAbi,
  type MandateView,
  type OrgRules,
  type PayeeView,
} from "@sendsure/chain";
import { AgentPanel } from "../../components/Agent";
import { Books } from "../../components/Books";
import { AddInvoice } from "../../components/Invoices";
import { Integrations } from "../../components/Integrations";
import { Notify } from "../../components/Notify";
import { GetSetUp } from "../../components/GetSetUp";
import { OrgClaims } from "../../components/Claims";
import { publicClient } from "../../lib/arc";
import { inviteLink, loadOrgs, newSalt, parseVendorLines, saveOrg, type SavedOrg, type Vendor } from "../../lib/orgStore";
import {
  connectBrowserWallet,
  isOnArc,
  signPermit,
  signText,
  switchToArc,
  testWallet,
  walletErrorText,
  type Signer,
} from "../../lib/wallet";
import { Help } from "../../components/Help";

const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const nowSec = () => Math.floor(Date.now() / 1000);

async function post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const out = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(out.error ?? `The server answered ${res.status}.`);
  return out as T;
}

export default function OrgPage() {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [onArc, setOnArc] = useState(true);
  const [orgs, setOrgs] = useState<SavedOrg[]>([]);
  const [selected, setSelected] = useState<Address | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setOrgs(loadOrgs()), []);

  // Orgs this wallet owns on Arc that this browser has never seen (made in another browser or on another computer).
  const [elsewhere, setElsewhere] = useState<Address[]>([]);
  useEffect(() => {
    setElsewhere([]);
    if (!signer || signer.kind === "test") return;
    fetch(`/api/org/mine?owner=${signer.address}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ orgs: { org: Address; tier: number }[] }>) : null))
      .then((out) => {
        const known = new Set(loadOrgs().map((o) => o.org.toLowerCase()));
        setElsewhere((out?.orgs ?? []).filter((o) => !known.has(o.org.toLowerCase())).map((o) => o.org));
      })
      .catch(() => undefined);
  }, [signer]);

  function openHere(org: Address) {
    if (!signer) return;
    remember({ org, owner: signer.address, name: "My team", salt: newSalt(), createdAt: Math.floor(Date.now() / 1000), vendors: [] });
    setElsewhere((list) => list.filter((o) => o !== org));
    setCreating(false);
  }

  const mine = useMemo(() => (signer ? orgs.filter((o) => same(o.owner, signer.address)) : []), [orgs, signer]);
  const current = mine.find((o) => same(o.org, selected ?? undefined)) ?? mine[0] ?? null;

  async function connect(kind: Signer["kind"]) {
    setError("");
    setBusy(true);
    try {
      const s = kind === "browser" ? await connectBrowserWallet() : testWallet();
      setSigner(s);
      setOnArc(await isOnArc(s));
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function doSwitch() {
    if (!signer) return;
    setError("");
    try {
      await switchToArc(signer);
      setOnArc(await isOnArc(signer));
    } catch (err) {
      setError(walletErrorText(err));
    }
  }

  function remember(org: SavedOrg) {
    setOrgs(saveOrg(org));
    setSelected(org.org);
  }

  return (
    <>
      <h1>Set up SendSure for your team</h1>
      <p className="lede">
        Create your org, set a budget, and invite the people you pay. You only sign; SendSure pays the gas. Your vendor names and
        your org&apos;s secret stay in this browser.
      </p>

      {!signer ? (
        <div className="card" style={{ maxWidth: 760 }}>
          <h3 style={{ marginTop: 0 }}>Connect the wallet that holds your team&apos;s USDC</h3>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => connect("browser")}>
              {busy ? "Waiting for your wallet…" : "Connect wallet"}
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => connect("test")}>
              Try it with a test wallet
            </button>
          </div>
          {busy && (
            <p className="notice">
              Your wallet opened a window asking to connect to SendSure. If you don&apos;t see it, click the MetaMask (or Rabby)
              icon in your browser&apos;s toolbar.
            </p>
          )}
          <p className="hint">
            This wallet becomes the owner and the treasury: payments come from it, only inside the rules you set. Arc testnet
            only.
          </p>
        </div>
      ) : !onArc ? (
        <p>
          <button className="btn" onClick={doSwitch}>
            Switch to Arc testnet
          </button>
        </p>
      ) : (
        <>
          {elsewhere.length > 0 && (
            <div className="notice warn">
              <p>
                <b>This wallet already owns {elsewhere.length === 1 ? "an org" : `${elsewhere.length} orgs`} on Arc</b> that this browser
                doesn&apos;t know yet (made in another browser or on another computer).
              </p>
              {elsewhere.map((o) => (
                <p key={o} className="row">
                  <span className="mono">{short(o)}</span>
                  <button className="btn secondary" onClick={() => openHere(o)}>
                    Open it here
                  </button>
                </p>
              ))}
              <p className="hint">
                The org, its budget and its payees&apos; proven addresses live on Arc and work here. Payee names stay in the browser
                where you typed them: download the org file there and use &ldquo;Import an org file&rdquo; (bottom of this page) to bring them over.
              </p>
            </div>
          )}
          <p className="hint">
            Connected: <span className="mono">{signer.address}</span>
            {signer.kind === "test" && " (a throwaway test wallet in this tab: close the tab and it is gone)"}
          </p>
          {mine.length > 1 && (
            <p>
              Org:{" "}
              <select value={current?.org} onChange={(e) => setSelected(e.target.value as Address)}>
                {mine.map((o) => (
                  <option key={o.org} value={o.org}>
                    {o.name} ({short(o.org)})
                  </option>
                ))}
              </select>
            </p>
          )}
          {!current || creating ? (
            <CreateOrg
              signer={signer}
              onCreated={(org) => {
                remember(org);
                setCreating(false);
              }}
              onCancel={current ? () => setCreating(false) : undefined}
            />
          ) : (
            <OrgView
              key={current.org}
              org={current}
              signer={signer}
              onChange={remember}
              onCreateAnother={() => setCreating(true)}
            />
          )}
          <Backup signer={signer} org={current} onImport={remember} />
        </>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!signer && <GetSetUp source="org" title="Prefer to set it up together?" />}
      <Help topic="setting up" />
    </>
  );
}

// ------------------------------------------------------------------ create

/** After a lost response: the newest org the factory created for this owner that this browser doesn't know yet. */
async function newOrgFor(owner: Address, known: Set<string>): Promise<Address | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`/api/org/mine?owner=${owner}`).catch(() => null);
    const out = res?.ok ? ((await res.json()) as { orgs: { org: Address }[] }) : null;
    const fresh = out?.orgs.find((o) => !known.has(o.org.toLowerCase()));
    if (fresh) return fresh.org;
  }
  return null;
}

function CreateOrg(props: { signer: Signer; onCreated: (org: SavedOrg) => void; onCancel?: () => void }) {
  const { signer, onCreated, onCancel } = props;
  const [name, setName] = useState("");
  const [approver, setApprover] = useState("");
  const [total, setTotal] = useState("100");
  const [perPayee, setPerPayee] = useState("50");
  const [perClaim, setPerClaim] = useState("50");
  const [cosign, setCosign] = useState("25");
  const [changeDays, setChangeDays] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tx, setTx] = useState<Hex | null>(null);

  async function create() {
    setError("");
    setBusy(true);
    try {
      const approverAddress = approver.trim() ? approver.trim() : signer.address;
      if (!isAddress(approverAddress, { strict: false }))
        throw new Error("The approver must be an address (0x…), or leave it empty.");
      const rules: OrgRules = {
        owner: signer.address,
        approvers: [getAddress(approverAddress)],
        caps: {
          orgPeriodCap: usdc(total),
          payeePeriodCap: usdc(perPayee),
          claimMax: usdc(perClaim),
          coSignThreshold: usdc(cosign),
        },
        periodLength: DEFAULT_PERIOD_SECONDS,
        changeCooldown: BigInt(changeDays) * 86_400n,
        sandbox: signer.kind === "test",
      };
      const validUntil = BigInt(nowSec() + 30 * 60);
      const signature = await signText(signer, createOrgMessage(rules, validUntil));
      const known = new Set(loadOrgs().map((o) => o.org.toLowerCase()));
      let out: { org?: Address; txHash?: Hex; status: string };
      try {
        out = await post<{ org?: Address; txHash: Hex; status: string }>("/api/org/create", { ...rules, validUntil, signature });
      } catch (err) {
        // A network failure can hide a success: look for a new org created for this wallet.
        if (!(err instanceof TypeError)) throw err;
        const found = await newOrgFor(signer.address, known);
        if (!found) throw err;
        out = { org: found, status: "success" };
      }
      if (out.txHash) setTx(out.txHash);
      if (!out.org) throw new Error(`The org was not created (${out.status}).`);
      onCreated({
        org: out.org,
        owner: signer.address,
        name: name.trim() || "My team",
        salt: newSalt(),
        createdAt: Date.now(),
        vendors: [],
        test: signer.kind === "test",
      });
    } catch (err) {
      setError(err instanceof Error && /invalid|decimal/i.test(err.message) ? "Check the amounts." : walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, hint?: string) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: "100%", padding: 8 }}
        inputMode="decimal"
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h3 style={{ marginTop: 0 }}>1. Create your org</h3>
      <div className="grid">
        <div>
          <label htmlFor="org-name">Team name</label>
          <input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Labs"
            style={{ width: "100%", padding: 8 }}
          />
          <p className="hint">Shown to your payees in their invite link. Not stored on-chain.</p>
        </div>
        <div>
          <label htmlFor="approver">Approver (co-signs payments)</label>
          <input
            id="approver"
            className="mono"
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="empty = you"
            style={{ width: "100%", padding: 8 }}
          />
          <p className="hint">A person, not the agent. Leave empty to approve yourself.</p>
        </div>
      </div>
      <h4>Budget (USDC per 30 days)</h4>
      <div className="grid">
        {field("cap-total", "In total", total, setTotal)}
        {field("cap-payee", "Per payee", perPayee, setPerPayee)}
        {field("cap-claim", "Per claim", perClaim, setPerClaim)}
        {field("cap-cosign", "Co-sign above", cosign, setCosign, "Every first payment to a new address is co-signed too.")}
      </div>
      <div style={{ marginTop: 12 }}>
        <label htmlFor="change-days">When a payee changes address, wait</label>
        <select id="change-days" value={changeDays} onChange={(e) => setChangeDays(e.target.value)}>
          {["1", "2", "3", "7"].map((d) => (
            <option key={d} value={d}>
              {d} day{d === "1" ? "" : "s"}
            </option>
          ))}
        </select>
      </div>
      <p className="privacy" style={{ marginTop: 16 }}>
        You sign these rules as plain text. SendSure&apos;s agents can then pay only inside them, only to payees who proved their
        own address. Signing is free.
      </p>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={busy} onClick={create}>
          {busy ? "Check your wallet, then wait for Arc…" : "Sign and create my org"}
        </button>
        {onCancel && (
          <button className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {tx && (
        <p className="hint">
          Transaction: <a href={explorerTx(tx)}>{short(tx)}</a>
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ org view

const STATUS: Record<PayeeView["state"], [string, string]> = {
  NONE: ["STOP", "Not opened"],
  OPEN: ["REVIEW", "Waiting for them"],
  BOUND: ["PAY", "Confirmed"],
  FROZEN: ["STOP", "Frozen"],
  REVOKED: ["STOP", "Cancelled"],
};

function OrgView(props: { org: SavedOrg; signer: Signer; onChange: (org: SavedOrg) => void; onCreateAnother: () => void }) {
  const { org, signer, onChange, onCreateAnother } = props;
  const [view, setView] = useState<MandateView | null>(null);
  const [payees, setPayees] = useState<Record<string, PayeeView>>({});
  const [loadError, setLoadError] = useState("");
  const [runs, setRuns] = useState(0);
  const payeeName = (ref: Hex) => org.vendors.find((v) => v.payeeRef.toLowerCase() === ref.toLowerCase())?.name ?? short(ref);
  /** Set right after invites were opened: re-read until they show up, in case the RPC node lags a block. */
  const justInvited = useRef(false);

  const refresh = useCallback(async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        const [v, entries] = await Promise.all([
          readMandate(publicClient, org.org),
          Promise.all(org.vendors.map(async (x) => [x.payeeRef, await readPayee(publicClient, org.org, x.payeeRef)] as const)),
        ]);
        const lagging = justInvited.current && entries.some(([, p]) => p.state === "NONE");
        if (!lagging || attempt >= 5) {
          justInvited.current = false;
          setView(v);
          setPayees(Object.fromEntries(entries));
          setLoadError("");
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      setLoadError("Could not reach Arc testnet. Refresh to try again.");
    }
  }, [org]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <div className="card" style={{ maxWidth: 900 }}>
        <h3 style={{ marginTop: 0 }}>{org.name}</h3>
        <dl className="facts">
          <dt>Org contract</dt>
          <dd>
            <a className="mono" href={explorerAddress(org.org)}>
              {org.org}
            </a>
          </dd>
          <dt>Treasury (you)</dt>
          <dd>
            <span className="mono">{org.owner}</span>
            {view && ` · holds ${formatUsdc(view.treasuryBalance)} USDC`}
          </dd>
          {view && (
            <>
              <dt>Rules</dt>
              <dd>
                {formatUsdc(view.caps.orgPeriodCap)} USDC per {Number(view.periodLength) / 86_400} days in total,{" "}
                {formatUsdc(view.caps.payeePeriodCap)} per payee, {formatUsdc(view.caps.claimMax)} per claim; a person co-signs
                above {formatUsdc(view.caps.coSignThreshold)} USDC and every first payment to a new address.
              </dd>
              <dt>Budget left</dt>
              <dd>{formatUsdc(view.allowance)} USDC (the most SendSure can ever move from your wallet until you add more)</dd>
            </>
          )}
        </dl>
        {loadError && <p className="notice">{loadError}</p>}
        {view && view.treasuryBalance < view.caps.claimMax && (
          <p className="notice warn">
            Your wallet holds {formatUsdc(view.treasuryBalance)} USDC. Get testnet USDC at{" "}
            <a href="https://faucet.circle.com">faucet.circle.com</a> (pick Arc testnet) before you pay anyone.
          </p>
        )}
        <p className="hint">
          <button className="linkish" onClick={onCreateAnother}>
            Create another org
          </button>
        </p>
      </div>

      {view && <Budget org={org} view={view} signer={signer} onDone={refresh} />}
      <Invites
        org={org}
        signer={signer}
        onInvited={(o) => {
          justInvited.current = true;
          onChange(o); // the new org re-renders this view, and the effect above reads the new invites
        }}
      />
      <Payees org={org} payees={payees} onRefresh={refresh} />
      <AgentPanel org={org.org} signer={signer} payeeName={payeeName} onRan={() => setRuns((n) => n + 1)} />
      <OrgClaims org={org.org} signer={signer} payeeName={payeeName} version={runs} />
      <Books org={org.org} orgName={org.name} signer={signer} payeeName={payeeName} />
      <AddInvoice org={org.org} signer={signer} vendors={org.vendors} />
      <Notify org={org.org} signer={signer} />
      <Integrations org={org.org} signer={signer} />
    </>
  );
}

function Budget(props: { org: SavedOrg; view: MandateView; signer: Signer; onDone: () => Promise<void> }) {
  const { org, view, signer, onDone } = props;
  const [amount, setAmount] = useState(formatUsdc(view.caps.orgPeriodCap));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tx, setTx] = useState<Hex | null>(null);

  async function approve() {
    setError("");
    setBusy(true);
    try {
      const nonce = await publicClient.readContract({
        address: deployment.usdc as Address,
        abi: usdcPermitAbi,
        functionName: "nonces",
        args: [signer.address],
      });
      const message = {
        owner: signer.address,
        spender: org.org,
        value: usdc(amount),
        nonce,
        deadline: BigInt(nowSec() + 30 * 60),
      };
      const signature = await signPermit(signer, message);
      const out = await post<{ txHash: Hex }>("/api/org/budget", { ...message, signature });
      setTx(out.txHash);
      await onDone();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>2. {view.allowance === 0n ? "Set the budget" : "Change the budget"}</h3>
      <p className="hint">
        You sign a USDC permit: your org may move at most this much from your wallet, and only through its rules. Set it to 0 to
        stop all payments at once.
      </p>
      <div className="row">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          style={{ width: 140, padding: 8 }}
        />
        <span>USDC</span>
        <button className="btn" disabled={busy} onClick={approve}>
          {busy ? "Check your wallet…" : "Sign budget"}
        </button>
      </div>
      {tx && (
        <p className="hint">
          Budget set: <a href={explorerTx(tx)}>{short(tx)}</a> (gas paid by SendSure)
        </p>
      )}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}

function Invites(props: { org: SavedOrg; signer: Signer; onInvited: (org: SavedOrg) => void }) {
  const { org, signer, onInvited } = props;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tx, setTx] = useState<Hex | null>(null);

  /** After a lost response, the chain is the truth: are all these invites open now? */
  async function openedOnChain(refs: Hex[]): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const states = await Promise.all(refs.map((ref) => readPayee(publicClient, org.org, ref).catch(() => null)));
      if (states.every((p) => p && p.state !== "NONE")) return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  async function invite() {
    setError("");
    setBusy(true);
    const fresh = parseVendorLines(text, org);
    const save = () => {
      setText("");
      onInvited({ ...org, vendors: [...org.vendors, ...fresh.map((v) => ({ ...v, invitedAt: Date.now() }))] });
    };
    try {
      if (!fresh.length) throw new Error("Add at least one new payee, one per line.");
      const refs = fresh.map((v) => v.payeeRef);
      const validUntil = BigInt(nowSec() + 10 * 60);
      const signature = await signText(signer, openInvitesMessage(org.org, inviteBatchHash(refs), refs.length, validUntil));
      let out: { txHash?: Hex; status: string } | null = null;
      try {
        out = await post<{ txHash?: Hex; status: string }>("/api/org/invites", {
          org: org.org,
          payeeRefs: refs,
          validUntil,
          signature,
        });
      } catch (err) {
        // A network failure can hide a success: check the chain before calling it an error.
        if (!(err instanceof TypeError) || !(await openedOnChain(refs))) throw err;
        out = { status: "success" };
      }
      if (out.status !== "success") throw new Error(`The invites were not opened (${out.status}).`);
      if (out.txHash) setTx(out.txHash);
      save();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 900, marginTop: 14 }}>
      <h3 style={{ marginTop: 0 }}>3. Invite the people you pay</h3>
      <label htmlFor="vendors">One per line: name, email (email optional)</label>
      <textarea
        id="vendors"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Maria Lopez, maria@example.com\nNorth Star Design"}
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={busy || !text.trim()} onClick={invite}>
          {busy ? "Check your wallet…" : "Sign and create invite links"}
        </button>
      </div>
      <p className="hint">
        Each payee gets a link to confirm their own payout address. Send it from your own email or chat, so they know it is you.
      </p>
      {tx && (
        <p className="hint">
          Invites opened: <a href={explorerTx(tx)}>{short(tx)}</a> (by the SendSure agent, gas paid by SendSure)
        </p>
      )}
      {error && <p className="notice">{error}</p>}
    </div>
  );
}

function Payees(props: { org: SavedOrg; payees: Record<string, PayeeView>; onRefresh: () => Promise<void> }) {
  const { org, payees, onRefresh } = props;
  const [copied, setCopied] = useState("");
  if (!org.vendors.length) return null;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const copy = async (v: Vendor) => {
    await navigator.clipboard.writeText(inviteLink(origin, org, v)).catch(() => undefined);
    setCopied(v.payeeRef);
  };
  const mailto = (v: Vendor) =>
    `mailto:${v.email ?? ""}?subject=${encodeURIComponent(`${org.name}: please confirm your payout address`)}&body=${encodeURIComponent(
      `Hi ${v.name},\n\nWe pay you through SendSure. Please confirm your payout address once here. It takes a minute and is free:\n${inviteLink(origin, org, v)}\n\nThanks,\n${org.name}`,
    )}`;

  return (
    <div style={{ maxWidth: 900, marginTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Payees</h3>
        <button className="linkish" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>
      <div className="table-wrap">
        <table style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Payee</th>
              <th>Status</th>
              <th>Payout address</th>
              <th>Invite</th>
            </tr>
          </thead>
          <tbody>
            {org.vendors.map((v) => {
              const p = payees[v.payeeRef];
              const [chip, label] = p ? STATUS[p.state] : ["REVIEW", "…"];
              return (
                <tr key={v.payeeRef}>
                  <td>
                    {v.name}
                    {v.email && <div className="hint">{v.email}</div>}
                  </td>
                  <td>
                    <span className={`chip ${chip}`}>{label}</span>
                    {p?.changePending && <div className="hint">change of address waiting</div>}
                  </td>
                  <td className="mono">
                    {p && p.state === "BOUND" ? <a href={explorerAddress(p.payout)}>{short(p.payout)}</a> : "-"}
                  </td>
                  <td>
                    <button className="linkish" onClick={() => void copy(v)}>
                      {copied === v.payeeRef ? "Copied" : "Copy link"}
                    </button>
                    {" · "}
                    <a href={mailto(v)}>Email</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ backup

function Backup(props: { signer: Signer; org: SavedOrg | null; onImport: (org: SavedOrg) => void }) {
  const { signer, org, onImport } = props;
  const [error, setError] = useState("");

  function download() {
    if (!org) return;
    const blob = new Blob([JSON.stringify(org, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sendsure-org-${org.org.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File) {
    setError("");
    try {
      const o = JSON.parse(await file.text()) as SavedOrg;
      if (!isAddress(o.org) || !isAddress(o.owner) || !/^0x[0-9a-fA-F]{64}$/.test(o.salt) || !Array.isArray(o.vendors)) {
        throw new Error("That is not a SendSure org file.");
      }
      if (!same(o.owner, signer.address))
        throw new Error(`That org belongs to ${short(o.owner)}; connect that wallet to use it.`);
      onImport(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    }
  }

  return (
    <div className="hint" style={{ marginTop: 24, maxWidth: 900 }}>
      {org && (
        <>
          <button className="linkish" onClick={download}>
            Download org file
          </button>{" "}
          (back it up: it holds your payee names and the secret that links them to their invites) ·{" "}
        </>
      )}
      <label style={{ display: "inline", fontWeight: 400 }}>
        Import an org file{" "}
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
        />
      </label>
      {error && <p className="notice">{error}</p>}
    </div>
  );
}
