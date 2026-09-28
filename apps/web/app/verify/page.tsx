"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  SIGNATURE_TTL_SECONDS,
  ZERO_BYTES32,
  arcTestnet,
  deployment,
  explorerAddress,
  explorerTx,
  formatDuration,
  payeeRegistryAbi,
  randomNonce,
  readOrg,
  readPayee,
  type BindMessage,
  type OrgView,
  type PayeeView,
} from "@sendsure/chain";
import { publicClient } from "../../lib/arc";
import {
  connectBrowserWallet,
  hasBrowserWallet,
  isOnArc,
  signBind,
  switchToArc,
  testWallet,
  walletErrorText,
  type Signer,
} from "../../lib/wallet";

interface Invite {
  org: Address;
  payeeRef: Hex;
  payer: string;
}

type Loaded =
  | { kind: "loading" }
  | { kind: "bad-link" }
  | { kind: "error"; text: string }
  | { kind: "ready"; org: OrgView; payee: PayeeView };

type Busy = "" | "connect" | "switch" | "sign" | "relay" | "self";

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

export default function VerifyPage() {
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [signer, setSigner] = useState<Signer | null>(null);
  const [onArc, setOnArc] = useState(true);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [relayFailed, setRelayFailed] = useState(false);
  const [tx, setTx] = useState<{ hash: Hex; status: string } | null>(null);

  useEffect(() => setInvite(readInvite()), []);

  /** Reads the invite. After our own transaction, `untilChanged` re-reads briefly in case the RPC node lags a block. */
  const refresh = useCallback(async (inv: Invite, untilChanged = false) => {
    try {
      for (let attempt = 0; ; attempt++) {
        const [org, payee] = await Promise.all([readOrg(publicClient, inv.org), readPayee(publicClient, inv.org, inv.payeeRef)]);
        if (!untilChanged || payee.state !== "OPEN" || attempt >= 5) {
          setLoaded({ kind: "ready", org, payee });
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      setLoaded({ kind: "error", text: "Could not reach Arc testnet. Refresh the page to try again." });
    }
  }, []);

  useEffect(() => {
    if (invite === null) setLoaded({ kind: "bad-link" });
    else if (invite) void refresh(invite);
  }, [invite, refresh]);

  // A browser wallet can switch network or account at any time; follow it.
  useEffect(() => {
    const provider = window.ethereum;
    if (signer?.kind !== "browser" || !provider) return;
    const onChain = () => void isOnArc(signer).then(setOnArc, () => setOnArc(false));
    const onAccounts = () => {
      setSigner(null);
      setError("Your wallet switched accounts. Connect again to continue.");
    };
    provider.on("chainChanged", onChain);
    provider.on("accountsChanged", onAccounts);
    return () => {
      provider.removeListener("chainChanged", onChain);
      provider.removeListener("accountsChanged", onAccounts);
    };
  }, [signer]);

  async function connect(kind: Signer["kind"]) {
    setError("");
    setBusy("connect");
    try {
      const s = kind === "browser" ? await connectBrowserWallet() : testWallet();
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
    setBusy("sign");
    try {
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
        body: JSON.stringify({ ...message, nonce: message.nonce.toString(), validUntil: message.validUntil.toString(), signature }),
      });
      const out = (await res.json().catch(() => ({}))) as { txHash?: Hex; status?: string; error?: string };
      if (!res.ok || !out.txHash) {
        setRelayFailed(res.status >= 500 || res.status === 429);
        throw new Error(out.error ?? `The relayer answered ${res.status}.`);
      }
      setTx({ hash: out.txHash, status: out.status ?? "pending" });
      await refresh(invite, true);
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
        chain: arcTestnet,
        address: deployment.payeeRegistry as Address,
        abi: payeeRegistryAbi,
        functionName: "bind",
        args: [invite.org, invite.payeeRef, ZERO_BYTES32, 0],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setTx({ hash, status: receipt.status });
      await refresh(invite, true);
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
      {loaded.kind === "loading" && <p className="hint">Checking your invite on Arc testnet…</p>}
      {loaded.kind === "bad-link" && <BadLink />}
      {loaded.kind === "error" && <p className="notice">{loaded.text}</p>}
      {loaded.kind === "ready" && invite && (
        <>
          <p className="lede">
            {payer} wants to pay you through SendSure. Sign once with the wallet you want to be paid to. After that, SendSure
            pays only that address, and changing it needs a signature from this wallet too.
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
                  </p>
                ) : (
                  <>
                    <div className="row">
                      <button className="btn" disabled={busy !== ""} onClick={() => connect("browser")}>
                        {busy === "connect" ? "Waiting for your wallet…" : "Connect wallet"}
                      </button>
                      <button className="btn secondary" disabled={busy !== ""} onClick={() => connect("test")}>
                        No wallet? Use a test wallet
                      </button>
                    </div>
                    <p className="hint">
                      {hasBrowserWallet() ? "Works with MetaMask, Rabby and other browser wallets. " : "No browser wallet found. "}
                      The test wallet is for trying SendSure on testnet only. For real payouts, use your own wallet.
                    </p>
                  </>
                )}
              </li>

              <li className={!signer ? "off" : onArc ? "done" : ""}>
                <h3>2. Use Arc testnet</h3>
                {signer && !onArc ? (
                  <button className="btn" disabled={busy !== ""} onClick={doSwitch}>
                    {busy === "switch" ? "Check your wallet…" : "Switch to Arc testnet"}
                  </button>
                ) : (
                  <p className="hint">{signer ? "Your wallet is on Arc testnet." : "After you connect."}</p>
                )}
              </li>

              <li className={!signer || !onArc ? "off" : ""}>
                <h3>3. Sign to confirm this address</h3>
                <p className="hint">
                  Your wallet shows a <b>Bind</b> request from <b>SendSure PayeeRegistry</b>: <i>org</i> is {payer}&apos;s
                  SendSure contract, <i>payout</i> is your address, and <i>nonce</i> is a one-time number.
                </p>
                <p className="privacy">Signing is free. It does not move money and does not let anyone use your wallet.</p>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn" disabled={!signer || !onArc || busy !== ""} onClick={confirm}>
                    {busy === "sign" ? "Check your wallet…" : busy === "relay" ? "Recording on Arc testnet…" : "Sign and confirm"}
                  </button>
                  {relayFailed && signer?.kind === "browser" && (
                    <button className="linkish" disabled={busy !== ""} onClick={sendItYourself}>
                      {busy === "self" ? "Sending…" : "Or send it yourself (needs a little testnet USDC for gas)"}
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
            />
          )}

          {error && <p className="notice" role="alert">{error}</p>}
          {tx && (
            <p className="hint">
              Transaction ({tx.status}): <a className="mono" href={explorerTx(tx.hash)}>{short(tx.hash)}</a>. The gas was paid by
              the SendSure relayer.
            </p>
          )}
        </>
      )}
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
          {invite.payer || "(no name in the link)"} <span className="hint">· the name comes from the link, not from the chain</span>
        </dd>
        <dt>Payer contract</dt>
        <dd>
          <a className="mono" href={explorerAddress(invite.org)}>{invite.org}</a>
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
}) {
  const { payee, org, payer, mine, connected, testWalletUsed } = props;
  if (payee.state === "NONE") {
    return <p className="notice warn">{payer} has not opened this invite yet. Ask them to send the link again once it is ready.</p>;
  }
  if (payee.state === "REVOKED") {
    return <p className="notice">{payer} cancelled this invite. Ask them for a new link.</p>;
  }
  if (payee.state === "FROZEN") {
    return <p className="notice warn">{payer} froze this payee while they check something. No payments go out until they unfreeze it.</p>;
  }
  const activeAt = new Date(Number(payee.activeAt) * 1000);
  const waiting = payee.activeAt * 1000n > BigInt(Date.now());
  if (!mine) {
    return (
      <div className="notice warn">
        <p>
          <b>{connected ? "This invite was already used by another address." : "This invite is already confirmed."}</b> {payer}{" "}
          can pay only <span className="mono">{payee.payout}</span>.
        </p>
        <p>If that is not your address, tell {payer} now. They can freeze it before any payment goes out.</p>
      </div>
    );
  }
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
        To change this address later, you sign with this wallet and the new one, and the change waits {formatDuration(org.changeCooldown)}{" "}
        before it counts.
      </p>
      {testWalletUsed && <p className="hint">You used a test wallet made in this browser tab. It disappears when you close the tab.</p>}
    </div>
  );
}

function BadLink() {
  return (
    <>
      <p className="lede">
        This page is for people who get paid. Your payer sends you a link to it, and you sign once with your wallet to
        prove the address is yours.
      </p>
      <p className="notice warn">This link is missing the invite details. Ask your payer to send the link again.</p>
      <p className="hint">
        Paying people? <a href="/check">Check your next payout</a> for changed or look-alike addresses first.
      </p>
    </>
  );
}
