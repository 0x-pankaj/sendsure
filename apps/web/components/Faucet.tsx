"use client";

import { useState } from "react";
import { explorerTx } from "@sendsure/chain";
import type { Hex } from "viem";
import { authedFetch, jsonOrThrow } from "../lib/sessionClient";
import { walletErrorText, type Signer } from "../lib/wallet";

/** One click for 2 test USDC from SendSure's testnet faucet (once per wallet), instead of leaving for faucet.circle.com. */
export function FaucetButton({ signer, onDone }: { signer: Signer; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Hex | null>(null);
  const [error, setError] = useState("");

  async function ask() {
    setError("");
    setBusy(true);
    try {
      const out = await jsonOrThrow<{ txHash: Hex }>(await authedFetch(signer, "/api/faucet", { method: "POST" }));
      setTx(out.txHash);
      onDone?.();
    } catch (err) {
      setError(walletErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (tx)
    return (
      <span>
        {" "}
        Sent 2 test USDC to your wallet (<a href={explorerTx(tx)}>transaction</a>).
      </span>
    );
  return (
    <>
      {" "}
      <button className="btn secondary" disabled={busy} onClick={() => void ask()} style={{ padding: "4px 10px" }}>
        {busy ? "Sending test USDC…" : "Get 2 test USDC from SendSure"}
      </button>
      {error && <span className="hint"> {error}</span>}
    </>
  );
}
