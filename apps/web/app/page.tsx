import { deployment, explorerAddress } from "@sendsure/chain";

export default function Home() {
  return (
    <>
      <h1>Pay only the right person.</h1>
      <p className="lede">
        SendSure is a payables agent for teams that pay contractors in stablecoins. It pays only a payee who proved their own
        address, only for a claim that payee signed, and only inside a budget an Arc contract enforces. Then it writes each payment
        into your books.
      </p>
      <div className="row">
        <a className="btn" href="/try">
          Try it in two minutes, no wallet needed
        </a>
        <a className="btn secondary" href="/check">
          Check your next payout (free)
        </a>
        <a className="btn secondary" href="/org">
          Set up your team
        </a>
      </div>

      <h2>How it works</h2>
      <ol className="steps">
        <li>
          <h3>1. Each payee proves their address, once</h3>
          <p className="hint">
            You send an invite link from your own email. The payee signs with their wallet; SendSure pays the gas. Changing that address
            later needs the old wallet and the new one, then a wait you can cancel.
          </p>
        </li>
        <li>
          <h3>2. Payees sign a claim for every invoice</h3>
          <p className="hint">
            Or you upload the invoice and Claude reads it, showing the exact words each value came from; the payee checks it and signs. A
            forged invoice cannot carry their signature, and the same invoice is never paid twice.
          </p>
        </li>
        <li>
          <h3>3. The agent checks every claim against your rules</h3>
          <p className="hint">
            It runs the contract&apos;s own dry run, then Claude reviews every run: anything unusual (the same work billed twice, a
            &ldquo;please pay my new wallet&rdquo; note, hidden instructions) is held with a plain reason, and a person co-signs first
            payments. Every decision is hash-chained and anchored on Arc.
          </p>
        </li>
        <li>
          <h3>4. The Circle agent wallet pays; your books reconcile</h3>
          <p className="hint">
            Money moves only from your own wallet, only through the contract. Each payment gets a public receipt and a beancount entry
            that matches your treasury&apos;s on-chain balance.
          </p>
        </li>
      </ol>

      <h2>Three rules the AI cannot skip</h2>
      <div className="grid">
        <div className="card">
          <b>The payee proved their address.</b>
          <p className="hint">They signed with it. Changing it needs the old key, the new key and a waiting period.</p>
        </div>
        <div className="card">
          <b>The payee signed this claim.</b>
          <p className="hint">A forged invoice cannot carry their signature, and an invoice is never paid twice.</p>
        </div>
        <div className="card">
          <b>A contract enforces the budget.</b>
          <p className="hint">Limits start at zero. New payees and large amounts need a human co-sign on-chain.</p>
        </div>
      </div>

      <h2>Live on Arc testnet, and checkable</h2>
      <ul>
        <li>
          <a href="/dashboard">Dashboard</a>: every number counted from chain events, with sandbox activity kept out of the traction count.
        </li>
        <li>
          A <a href="/receipt?tx=0xcfbb0de697f5a1349997b798de2443e358844ad39b47eb26a36553bd3128e89e">payment receipt</a>: the payee&apos;s
          proof of address, their signed claim, and the agent&apos;s anchored decision.
        </li>
        <li>
          PayeeRegistry <a className="mono" href={explorerAddress(deployment.payeeRegistry)}>{deployment.payeeRegistry}</a> ·
          MandateFactory <a className="mono" href={explorerAddress(deployment.mandateFactory)}>{deployment.mandateFactory}</a>
        </li>
        <li>
          For agents: <span className="mono">claude mcp add --transport http sendsure https://sendsure.0xpankaj.workers.dev/api/mcp</span>
        </li>
        <li>
          Agents can pay per check in USDC, with x402 over Circle Gateway: $0.001 to verify a payee, $0.005 to check a payout file.{" "}
          <a href="/api/x402">Catalog</a>.
        </li>
        <li>
          <a href="https://github.com/0x-pankaj/sendsure">Source and test runs</a> (MIT). <a href="/status">System status</a>.
        </li>
      </ul>
    </>
  );
}
