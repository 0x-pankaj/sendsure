import { deployment, explorerAddress } from "@sendsure/chain";

export default function Home() {
  return (
    <>
      <h1>Pay only the right person.</h1>
      <p className="lede">
        SendSure is a payables agent for teams that pay contractors in stablecoins. It pays only a payee who proved their
        own address, only for a claim that payee signed, and only inside a budget an Arc contract enforces.
      </p>
      <div className="row">
        <a className="btn" href="/check">Check your next payout (free)</a>
      </div>
      <h2>Three rules the AI cannot skip</h2>
      <div className="grid">
        <div className="card"><b>The payee proved their address.</b><p className="hint">They signed with it. Changing it needs the old key, the new key and a waiting period.</p></div>
        <div className="card"><b>The payee signed this claim.</b><p className="hint">A forged invoice cannot carry their signature, and an invoice is never paid twice.</p></div>
        <div className="card"><b>A contract enforces the budget.</b><p className="hint">Limits start at zero. New payees and large amounts need a human co-sign on-chain.</p></div>
      </div>
      <h2>Live on Arc testnet</h2>
      <ul>
        <li>PayeeRegistry: <a className="mono" href={explorerAddress(deployment.payeeRegistry)}>{deployment.payeeRegistry}</a></li>
        <li>MandateFactory: <a className="mono" href={explorerAddress(deployment.mandateFactory)}>{deployment.mandateFactory}</a></li>
        <li><a href="https://github.com/0x-pankaj/sendsure/blob/main/deployments/smoke-test.md">Smoke test</a>: the Circle agent wallet pays, a retry is refused, a forged claim is refused.</li>
      </ul>
    </>
  );
}
