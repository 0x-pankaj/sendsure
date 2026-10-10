"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, getAddress, isAddress, type Address, type Hex } from "viem";
import { deployment, explorerAddress, explorerTx, formatUsdc, usdc } from "@sendsure/chain";
import { publicClient } from "../lib/arc";
import { sendUsdcWithPasskey, type PasskeySigner } from "../lib/passkey";
import { walletErrorText } from "../lib/wallet";

/** The payee's passkey wallet: what it holds, and a way to move it out. Gas is paid by Circle Gas Station. */
export function PasskeyWallet({ signer }: { signer: PasskeySigner }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tx, setTx] = useState<Hex | null>(null);

  const load = useCallback(async () => {
    setBalance(
      await publicClient
        .readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [signer.address] })
        .catch(() => null),
    );
  }, [signer.address]);
  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setError("");
    setTx(null);
    try {
      if (!isAddress(to.trim())) throw new Error("Enter the address to send to (0x…).");
      if (!(Number(amount) > 0)) throw new Error("Enter the amount in USDC.");
      const value = usdc(amount);
      if (balance !== null && value > balance) throw new Error("That is more than this wallet holds.");
      setBusy(true);
      setTx(await sendUsdcWithPasskey(signer, getAddress(to.trim()), value));
      setAmount("");
      await load();
    } catch (err) {
      setError(err instanceof Error && /decimal|invalid/i.test(err.message) ? "Check the amount." : walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Your passkey wallet</h3>
      <p>
        <a className="mono" href={explorerAddress(signer.address)}>
          {signer.address}
        </a>{" "}
        holds <b>{balance === null ? "…" : formatUsdc(balance)} USDC</b> (Arc testnet).
      </p>
      <p className="hint">
        Only your passkey can move it. Your phone keeps the passkey (iCloud Keychain or Google Password Manager), so it comes with
        you to a new phone. Send your USDC to another wallet or an exchange address when you like; check the address first,
        because a transfer cannot be undone.
      </p>
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <div>
          <label htmlFor="pk-to">Send to</label>
          <input id="pk-to" className="mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pk-amount">Amount (USDC)</label>
          <input id="pk-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn secondary" disabled={busy || !balance} onClick={() => void send()}>
          {busy ? "Confirm with your passkey…" : "Send USDC"}
        </button>
        <button className="linkish" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p className="notice">{error}</p>}
      {tx && (
        <p className="hint">
          Sent:{" "}
          <a className="mono" href={explorerTx(tx)}>
            {tx.slice(0, 10)}…
          </a>
          . The gas was paid by Circle Gas Station.
        </p>
      )}
    </div>
  );
}
