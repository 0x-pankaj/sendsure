"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  ORG_TIER,
  SIGNATURE_TTL_SECONDS,
  ZERO_BYTES32,
  arc,
  controllerRoleOf,
  controllerRoleText,
  deployment,
  explorerAddress,
  explorerTx,
  formatDuration,
  mandateAbi,
  payeeRegistryAbi,
  randomNonce,
  readOrg,
  readPayee,
  readPendingChange,
  type BindMessage,
  type ChangeMessage,
  type OrgView,
  type PayeeView,
  type PendingChange,
} from "@sendsure/chain";
import { PayeeClaims } from "../../components/Claims";
import { PasskeyWallet } from "../../components/PasskeyWallet";
import { publicClient } from "../../lib/arc";
import { bindWithPasskey, passkeyWallet, passkeysAvailable, savedPasskeyWallet } from "../../lib/passkey";
import {
  connectBrowserWallet,
  hasBrowserWallet,
  isOnArc,
  newTestWallet,
  signBind,
  signChange,
  switchToArc,
  testWallet,
  walletErrorText,
  type Signer,
} from "../../lib/wallet";
import { Help } from "../../components/Help";
import { ping } from "../../lib/ping";
import { FEATURES, IS_MAINNET, NETWORK_NAME } from "../../lib/network";

interface Invite {
  org: Address;
  payeeRef: Hex;
  payer: string;
}

type Loaded =
  | { kind: "loading" }
  | { kind: "bad-link" }
  | { kind: "error"; text: string }
  | { kind: "ready"; org: OrgView; payee: PayeeView; pending: PendingChange | null };

type Busy = "" | "connect" | "passkey" | "switch" | "sign" | "relay" | "self";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());

/** /verify?org=<payer contract>&ref=<invite id>&name=<payer name> */
function readInvite(): Invite | null {
  const q = new URLSearchParams(window.location.search);
  const org = q.get("org") ?? "";
  const ref = q.get("ref") ?? "";
  if (!isAddress(org, { strict: false }) || !/^0x[0-9a-fA-F]{64}$/.test(ref)) return null;
  return { org: getAddress(org), payeeRef: ref as Hex, payer: (q.get("name") ?? "").trim().slice(0, 80) };
}

/** MetaMask's universal link: opens this exact page in the MetaMask app's browser (or the store if it is missing). */
function metamaskLink(): string {
  if (typeof window === "undefined") return "https://metamask.app.link";
  const { host, pathname, search } = window.location;
  return `https://metamask.app.link/dapp/${host}${pathname}${search}`;
}

export default function VerifyPage() {
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [signer, setSigner] = useState<Signer | null>(null);
  const [onArc, setOnArc] = useState(true);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [relayFailed, setRelayFailed] = useState(false);
  const [tx, setTx] = useState<{ hash: Hex; status: string } | null>(null);
  const [changing, setChanging] = useState(false);
  // A test wallet is offered only on sandbox orgs: on a real payer's invite it would bind a key that vanishes with the tab.
  const [sandboxOrg, setSandboxOrg] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const inv = readInvite();
    setInvite(inv);
    if (inv) ping("invite_open");
  }, []);
  useEffect(() => {
    if (!invite) return;
    publicClient
      .readContract({ address: invite.org, abi: mandateAbi, functionName: "tier" })
      .then((t) => setSandboxOrg(Number(t) === ORG_TIER.SANDBOX))
      .catch(() => setSandboxOrg(false));
  }, [invite]);

  /** Reads the invite. After our own transaction, `until` re-reads briefly in case the RPC node lags a block. */
  const refresh = useCallback(async (inv: Invite, until?: (p: PayeeView) => boolean) => {
    try {
      for (let attempt = 0; ; attempt++) {
        const [org, payee, pending] = await Promise.all([
          readOrg(publicClient, inv.org),
          readPayee(publicClient, inv.org, inv.payeeRef),
          readPendingChange(publicClient, inv.org, inv.payeeRef),
        ]);
        if (!until || until(payee) || attempt >= 5) {
          setLoaded({ kind: "ready", org, payee, pending });
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      setLoaded({ kind: "error", text: `Could not reach ${NETWORK_NAME}. Refresh the page to try again.` });
    }
  }, []);

  useEffect(() => {
    if (invite === null) setLoaded({ kind: "bad-link" });
    else if (invite) void refresh(invite);
  }, [invite, refresh]);

  // A passkey wallet used before in this browser comes back without a prompt, if it is the address this payer pays.
  const boundPayout = loaded.kind === "ready" && loaded.payee.state !== "OPEN" ? loaded.payee.payout : undefined;
  useEffect(() => {
    if (signer || !boundPayout) return;
    void savedPasskeyWallet().then((s) => {
      if (s && same(s.address, boundPayout)) setSigner((old) => old ?? s);
    });
  }, [signer, boundPayout]);

  // A browser wallet can switch network or account at any time; follow it.
  useEffect(() => {
    const provider = window.ethereum;
    if (signer?.kind !== "browser" || !provider) return;
    const onChain = () => void isOnArc(signer).then(setOnArc, () => setOnArc(false));
    const onAccounts = () => {
      if (changing) return; // switching to the new address is part of the change flow
      setSigner(null);
      setError("Your wallet switched accounts. Connect again to continue.");
    };
    provider.on("chainChanged", onChain);
    provider.on("accountsChanged", onAccounts);
    return () => {
      provider.removeListener("chainChanged", onChain);
      provider.removeListener("accountsChanged", onAccounts);
    };
  }, [signer, changing]);

  async function connect(kind: Signer["kind"] | "passkey-new") {
    setError("");
    setBusy(kind === "passkey" || kind === "passkey-new" ? "passkey" : "connect");
    try {
      const s =
        kind === "browser"
          ? await connectBrowserWallet()
          : kind === "passkey" || kind === "passkey-new"
            ? await passkeyWallet(kind === "passkey-new")
            : testWallet();
      setSigner(s);
      setOnArc(await isOnArc(s));
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy("");
    }
  }

  async function doSwitch() {
    if (!signer) return;
    setError("");
    setBusy("switch");
    try {
      await switchToArc(signer);
      setOnArc(await isOnArc(signer));
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy("");
    }
  }

  async function confirm() {
    if (!signer || !invite) return;
    setError("");
    setRelayFailed(false);
    if (signer.kind === "passkey") {
      setBusy("relay");
      try {
        const hash = await bindWithPasskey(signer, invite.org, invite.payeeRef);
        setTx({ hash, status: "success" });
        await refresh(invite, (p) => p.state !== "OPEN");
      } catch (err) {
        setError(walletErrorText(err));
      } finally {
        setBusy("");
      }
      return;
    }
    setBusy("sign");
    try {
      // Before anything is signed: the org would never pay one of its own wallets (the payer trying their own link).
      const role = await controllerRoleOf(publicClient, invite.org, signer.address).catch(() => null);
      if (role) throw new Error(controllerRoleText(role));
      const message: BindMessage = {
        org: invite.org,
        payeeRef: invite.payeeRef,
        payout: signer.address,
        realAccountCommit: ZERO_BYTES32,
        realProofType: 0,
        nonce: randomNonce(),
        validUntil: BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS),
      };
      const signature = await signBind(signer, message);
      setBusy("relay");
      const res = await fetch("/api/relay/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...message,
          nonce: message.nonce.toString(),
          validUntil: message.validUntil.toString(),
          signature,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { txHash?: Hex; status?: string; error?: string };
      if (!res.ok || !out.txHash) {
        setRelayFailed(res.status >= 500 || res.status === 429);
        throw new Error(out.error ?? `The relayer answered ${res.status}.`);
      }
      setTx({ hash: out.txHash, status: out.status ?? "pending" });
      await refresh(invite, (p) => p.state !== "OPEN");
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy("");
    }
  }

  /** Fallback when the relayer is down: the payee sends bind() from their own wallet and pays the gas. */
  async function sendItYourself() {
    if (signer?.kind !== "browser" || !invite) return;
    setError("");
    setBusy("self");
    try {
      const hash = await signer.client.writeContract({
        account: signer.address,
        chain: arc,
        address: deployment.payeeRegistry as Address,
        abi: payeeRegistryAbi,
        functionName: "bind",
        args: [invite.org, invite.payeeRef, ZERO_BYTES32, 0],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setTx({ hash, status: receipt.status });
      await refresh(invite, (p) => p.state !== "OPEN");
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy("");
    }
  }

  const payer = invite?.payer || "Your payer";

  return (
    <>
      <h1>Confirm your payout address</h1>
      {loaded.kind === "loading" && <p className="hint">Checking your invite on {NETWORK_NAME}…</p>}
      {loaded.kind === "bad-link" && <BadLink />}
      {loaded.kind === "error" && <p className="notice">{loaded.text}</p>}
      {loaded.kind === "ready" && invite && (
        <>
          <p className="lede">
            {payer} wants to pay you through SendSure. Sign once with the wallet you want to be paid to. After that, SendSure pays
            only that address, and changing it needs a signature from this wallet too.
          </p>
          <InviteFacts invite={invite} payee={loaded.payee} />

          {!loaded.org.registered ? (
            <p className="notice">This link does not point to a SendSure payer. Ask {payer} for a new invite link.</p>
          ) : loaded.payee.state === "OPEN" ? (
            <ol className="steps">
              <li className={signer ? "done" : ""}>
                <h3>1. Choose the wallet you want to be paid to</h3>
                {signer ? (
                  <p>
                    Connected: <span className="mono">{signer.address}</span>
                    {signer.kind === "test" && " (a test wallet made in this browser tab)"}
                    {signer.kind === "passkey" && " (your passkey wallet: only your passkey can use it)"}
                  </p>
                ) : (
                  <>
                    {hasBrowserWallet() ? (
                      <div className="row">
                        <button className="btn" disabled={busy !== ""} onClick={() => connect("browser")}>
                          {busy === "connect" ? "Waiting for your wallet…" : "Connect wallet"}
                        </button>
                        {sandboxOrg && FEATURES.tryIt && (
                          <button className="btn secondary" disabled={busy !== ""} onClick={() => connect("test")}>
                            No wallet? Use a test wallet
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="notice warn">
                        <p>
                          <b>No wallet in this browser.</b> On a phone, open this page inside your wallet app. On a computer,
                          install MetaMask or Rabby, then reload.
                        </p>
                        <div className="row" style={{ marginTop: 8 }}>
                          <a className="btn" href={metamaskLink()}>
                            Open in MetaMask
                          </a>
                          <button
                            className="btn secondary"
                            onClick={() =>
                              void navigator.clipboard.writeText(window.location.href).then(() => setCopied(true), () => undefined)
                            }
                          >
                            {copied ? "Link copied" : "Copy this link"}
                          </button>
                          {sandboxOrg && FEATURES.tryIt && (
                            <button className="btn secondary" disabled={busy !== ""} onClick={() => connect("test")}>
                              Use a test wallet
                            </button>
                          )}
                        </div>
                        <p className="hint">
                          Other wallet apps (Rabby, Coinbase Wallet, Trust): open their built-in browser and paste the link.
                        </p>
                      </div>
                    )}
                    {passkeysAvailable() && (
                      <div className="notice ok" style={{ marginTop: 10 }}>
                        <p>
                          <b>No wallet app?</b> Get paid with a passkey: Face ID, your fingerprint or your phone&apos;s PIN.
                          SendSure makes you a wallet that only your passkey can use (a Circle smart account), and the gas is
                          paid for you.
                        </p>
                        <div className="row" style={{ marginTop: 8 }}>
                          <button className="btn" disabled={busy !== ""} onClick={() => connect("passkey-new")}>
                            {busy === "passkey" ? "Follow your phone's prompt…" : "Create a passkey wallet"}
                          </button>
                          <button className="btn secondary" disabled={busy !== ""} onClick={() => connect("passkey")}>
                            I already have one
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="hint">
                      {sandboxOrg
                        ? "This is a test org. The test wallet is for trying SendSure only; for real payouts, use your own wallet."
                        : "Use a wallet you control: this address is where you will be paid. Works with MetaMask, Rabby and other EVM wallets."}
                    </p>
                  </>
                )}
              </li>

              <li className={!signer ? "off" : onArc ? "done" : ""}>
                <h3>2. Use {NETWORK_NAME}</h3>
                {signer && !onArc ? (
                  <button className="btn" disabled={busy !== ""} onClick={doSwitch}>
                    {busy === "switch" ? "Check your wallet…" : `Switch to ${NETWORK_NAME}`}
                  </button>
                ) : (
                  <p className="hint">{signer ? `Your wallet is on ${NETWORK_NAME}.` : "After you connect."}</p>
                )}
              </li>

              <li className={!signer || !onArc ? "off" : ""}>
                <h3>3. Sign to confirm this address</h3>
                {signer?.kind === "passkey" ? (
                  <p className="hint">
                    Your passkey confirms it: your wallet registers itself with {payer}&apos;s SendSure contract on Arc. It costs you
                    nothing; Circle Gas Station pays the gas.
                  </p>
                ) : (
                  <>
                    <p className="hint">
                      Your wallet shows a <b>Bind</b> request from <b>SendSure PayeeRegistry</b>: <i>org</i> is {payer}&apos;s
                      SendSure contract, <i>payout</i> is your address, and <i>nonce</i> is a one-time number.
                    </p>
                    <p className="privacy">Signing is free. It does not move money and does not let anyone use your wallet.</p>
                  </>
                )}
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn" disabled={!signer || !onArc || busy !== ""} onClick={confirm}>
                    {busy === "sign"
                      ? "Check your wallet…"
                      : busy === "relay"
                        ? signer?.kind === "passkey"
                          ? "Confirm with your passkey, then recording on Arc…"
                          : `Recording on ${NETWORK_NAME}…`
                        : "Sign and confirm"}
                  </button>
                  {relayFailed && signer?.kind === "browser" && (
                    <button className="linkish" disabled={busy !== ""} onClick={sendItYourself}>
                      {busy === "self" ? "Sending…" : `Or send it yourself (needs a little ${IS_MAINNET ? "" : "testnet "}USDC for gas)`}
                    </button>
                  )}
                </div>
              </li>
            </ol>
          ) : (
            <BindingState
              payee={loaded.payee}
              org={loaded.org}
              payer={payer}
              mine={same(signer?.address, loaded.payee.payout) || Boolean(tx)}
              connected={Boolean(signer)}
              testWalletUsed={signer?.kind === "test"}
              pending={loaded.pending}
            >
              {signer &&
                signer.kind !== "passkey" &&
                same(signer.address, loaded.payee.payout) &&
                loaded.payee.tier === "PROVEN" &&
                !loaded.payee.changePending && (
                  <ChangeAddress
                    invite={invite}
                    signer={signer}
                    payer={payer}
                    cooldown={loaded.org.changeCooldown}
                    onBusy={setChanging}
                    onDone={async (hash) => {
                      setTx({ hash, status: "success" });
                      await refresh(invite, (p) => p.changePending);
                    }}
                  />
                )}
            </BindingState>
          )}

          {loaded.payee.state === "BOUND" && !signer && (
            <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
              <h3 style={{ marginTop: 0 }}>Is this you?</h3>
              <p className="hint">Connect the wallet {payer} pays to send a claim or change your address.</p>
              <div className="row">
                <button className="btn" disabled={busy !== ""} onClick={() => connect("browser")}>
                  {busy === "connect" ? "Waiting for your wallet…" : "Connect wallet"}
                </button>
                {passkeysAvailable() && (
                  <button className="btn secondary" disabled={busy !== ""} onClick={() => connect("passkey")}>
                    {busy === "passkey" ? "Follow your phone's prompt…" : "Use my passkey wallet"}
                  </button>
                )}
                <button className="btn secondary" disabled={busy !== ""} onClick={() => connect("test")}>
                  Use the test wallet from this tab
                </button>
              </div>
            </div>
          )}

          {loaded.payee.state === "BOUND" &&
            signer &&
            same(signer.address, loaded.payee.payout) &&
            !loaded.payee.changePending && (
              <>
                <PayeeClaims org={invite.org} payeeRef={invite.payeeRef} signer={signer} payer={payer} />
                {signer.kind === "passkey" && <PasskeyWallet signer={signer} />}
              </>
            )}

          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          {tx && (
            <p className="hint">
              Transaction ({tx.status}):{" "}
              <a className="mono" href={explorerTx(tx.hash)}>
                {short(tx.hash)}
              </a>
              . The gas was paid {signer?.kind === "passkey" ? "by Circle Gas Station" : "by the SendSure relayer"}.
            </p>
          )}
        </>
      )}
      <Help topic="confirming your address" />
    </>
  );
}

function InviteFacts({ invite, payee }: { invite: Invite; payee: PayeeView }) {
  const status: Record<PayeeView["state"], [string, string]> = {
    NONE: ["STOP", "Not opened by the payer"],
    OPEN: ["REVIEW", "Waiting for you"],
    BOUND: ["PAY", "Confirmed"],
    FROZEN: ["STOP", "Frozen by the payer"],
    REVOKED: ["STOP", "Cancelled by the payer"],
  };
  const [chip, label] = status[payee.state];
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <dl className="facts">
        <dt>From</dt>
        <dd>
          {invite.payer || "(no name in the link)"}{" "}
          <span className="hint">· the name comes from the link, not from the chain</span>
        </dd>
        <dt>Payer contract</dt>
        <dd>
          <a className="mono" href={explorerAddress(invite.org)}>
            {invite.org}
          </a>
        </dd>
        <dt>Invite</dt>
        <dd>
          <span className={`chip ${chip}`}>{label}</span>
        </dd>
      </dl>
    </div>
  );
}

function BindingState(props: {
  payee: PayeeView;
  org: OrgView;
  payer: string;
  mine: boolean;
  connected: boolean;
  testWalletUsed: boolean;
  pending: PendingChange | null;
  children?: React.ReactNode;
}) {
  const { payee, org, payer, mine, connected, testWalletUsed, pending, children } = props;
  const pendingNotice = pending && (
    <div className="notice warn">
      <p>
        <b>A change of payout address is waiting.</b> From {new Date(Number(pending.effectiveAt) * 1000).toLocaleString()},{" "}
        {payer} pays <span className="mono">{pending.newPayout}</span> instead of <span className="mono">{payee.payout}</span>.
      </p>
      <p>
        Until then, payments still go to the current address. If this change was not you, tell {payer} now: they can cancel it.
      </p>
    </div>
  );
  if (payee.state === "NONE") {
    return (
      <p className="notice warn">{payer} has not opened this invite yet. Ask them to send the link again once it is ready.</p>
    );
  }
  if (payee.state === "REVOKED") {
    return <p className="notice">{payer} cancelled this invite. Ask them for a new link.</p>;
  }
  if (payee.state === "FROZEN") {
    return (
      <p className="notice warn">
        {payer} froze this payee while they check something. No payments go out until they unfreeze it.
      </p>
    );
  }
  const activeAt = new Date(Number(payee.activeAt) * 1000);
  const waiting = payee.activeAt * 1000n > BigInt(Date.now());
  if (!mine) {
    return (
      <>
        <div className="notice warn">
          <p>
            <b>{connected ? "This invite was already used by another address." : "This invite is already confirmed."}</b> {payer}{" "}
            can pay only <span className="mono">{payee.payout}</span>.
          </p>
          <p>If that is not your address, tell {payer} now. They can freeze it before any payment goes out.</p>
        </div>
        {pendingNotice}
      </>
    );
  }
  if (pending) return pendingNotice;
  return (
    <div className="notice ok">
      <p>
        <b>Done. Your address is confirmed.</b> {payer} can pay only <span className="mono">{payee.payout}</span>.
      </p>
      <p>
        {waiting ? `Payments can start after ${activeAt.toLocaleString()}. ` : ""}
        The first payment to a new address still needs a person at {payer} to approve it.
      </p>
      <p>
        <b>Keep this link.</b> Each invoice {payer} sends for payment shows up here, for you to check and sign; they may
        also email you when one is waiting.
      </p>
      <p>
        To change this address later, you sign with this wallet and the new one, and the change waits{" "}
        {formatDuration(org.changeCooldown)} before it counts.
      </p>
      {testWalletUsed && (
        <p className="hint">You used a test wallet made in this browser tab. It disappears when you close the tab.</p>
      )}
      {children}
    </div>
  );
}

/**
 * Move payouts to a new address. The registry needs BOTH keys to sign the same ChangePayout, then
 * waits the org's change cooldown; the payer can cancel in that window.
 */
function ChangeAddress(props: {
  invite: Invite;
  signer: Signer;
  payer: string;
  cooldown: bigint;
  onBusy: (busy: boolean) => void;
  onDone: (hash: Hex) => Promise<void>;
}) {
  const { invite, signer, payer, cooldown, onBusy, onDone } = props;
  const [open, setOpen] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [pendingSig, setPendingSig] = useState<{ message: ChangeMessage; oldSig: Hex } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const messageFor = (newPayout: Address): ChangeMessage => ({
    org: invite.org,
    payeeRef: invite.payeeRef,
    oldPayout: signer.address,
    newPayout,
    nonce: randomNonce(),
    validUntil: BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS),
  });

  async function run(step: string, fn: () => Promise<void>) {
    setError("");
    setBusy(step);
    onBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy("");
      onBusy(false);
    }
  }

  async function relay(message: ChangeMessage, oldSig: Hex, newSig: Hex) {
    const res = await fetch("/api/relay/change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...message,
        nonce: message.nonce.toString(),
        validUntil: message.validUntil.toString(),
        oldSig,
        newSig,
      }),
    });
    const out = (await res.json().catch(() => ({}))) as { txHash?: Hex; error?: string };
    if (!res.ok || !out.txHash) throw new Error(out.error ?? `The relayer answered ${res.status}.`);
    setPendingSig(null);
    setOpen(false);
    await onDone(out.txHash);
  }

  // Test wallet: make a second throwaway wallet and sign with both, in one click.
  const tryWithTestWallets = () =>
    run("test", async () => {
      const next = newTestWallet();
      const message = messageFor(next.address);
      await relay(message, await signChange(signer, message), await signChange(next, message));
    });

  // Browser wallet, step 1: the current address signs the change to the address typed in.
  const signWithCurrent = () =>
    run("old", async () => {
      if (!isAddress(newAddress.trim(), { strict: false })) throw new Error("Enter the new address (0x…).");
      const newPayout = getAddress(newAddress.trim());
      if (same(newPayout, signer.address)) throw new Error("That is the address you use now.");
      const message = messageFor(newPayout);
      setPendingSig({ message, oldSig: await signChange(signer, message) });
    });

  // Browser wallet, step 2: the new address signs the same change.
  const signWithNew = () =>
    run("new", async () => {
      if (!pendingSig) return;
      const next = await connectBrowserWallet(true);
      if (!same(next.address, pendingSig.message.newPayout)) {
        throw new Error(
          `Your wallet is on ${short(next.address)}. Switch it to ${short(pendingSig.message.newPayout)} and try again.`,
        );
      }
      await relay(pendingSig.message, pendingSig.oldSig, await signChange(next, pendingSig.message));
    });

  if (!open) {
    return (
      <p>
        <button className="linkish" onClick={() => setOpen(true)}>
          Need to be paid to a different address?
        </button>
      </p>
    );
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Change your payout address</h3>
      <p className="hint">
        Both wallets sign: the one you use now and the new one. Then the change waits {formatDuration(cooldown)}, and {payer} can
        cancel it in that time. Someone who only has your new address, or only an email from you, cannot move your payouts.
      </p>
      {signer.kind === "test" ? (
        <button className="btn" disabled={busy !== ""} onClick={tryWithTestWallets}>
          {busy ? "Signing and recording…" : "Try it with a new test wallet"}
        </button>
      ) : !pendingSig ? (
        <>
          <label htmlFor="new-address">New address</label>
          <input
            id="new-address"
            className="mono"
            style={{ width: "100%", maxWidth: 460, padding: 8 }}
            placeholder="0x…"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy !== ""} onClick={signWithCurrent}>
              {busy === "old" ? "Check your wallet…" : "1. Sign with the wallet you use now"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Now open your wallet and switch to <span className="mono">{pendingSig.message.newPayout}</span>.
          </p>
          <button className="btn" disabled={busy !== ""} onClick={signWithNew}>
            {busy === "new" ? "Check your wallet…" : "2. Sign with the new wallet"}
          </button>
        </>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BadLink() {
  return (
    <>
      <p className="lede">
        This page is for people who get paid. Your payer sends you a link to it, and you sign once with your wallet to prove the
        address is yours.
      </p>
      <p className="notice warn">This link is missing the invite details. Ask your payer to send the link again.</p>
      <p className="hint">
        Paying people? <a href="/check">Check your next payout</a> for changed or look-alike addresses first.
      </p>
    </>
  );
}
