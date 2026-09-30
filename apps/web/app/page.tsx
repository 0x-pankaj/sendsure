import { deployment, explorerAddress, explorerTx } from "@sendsure/chain";

// A real payment on Arc testnet from our own end-to-end run (a sandbox org), shown as it is on its receipt.
const SAMPLE = {
  tx: "0xcfbb0de697f5a1349997b798de2443e358844ad39b47eb26a36553bd3128e89e",
  payout: "0x53CC78E9F5eE116Ef7A0e12Dd77AD2a2B8Da591a",
  amount: "0.30",
  proofTx: "0xd85b294197a73b94bc4687a240b3f639b3d836dea8954dcf27e56c85fe823a26",
  anchorTx: "0x50a8b1ae9083919c992311e89923d6baedbfeb42af282d8dd628ded757cdc913",
};
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const REPO = "https://github.com/0x-pankaj/sendsure";

export default function Home() {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Payables agent · USDC on Arc</p>
          <h1>
            Pay only the <em>right person</em>.
          </h1>
          <p className="lede">
            SendSure is a payables agent for teams that pay contractors and vendors in stablecoins. It pays only a payee who
            proved their own address, only for a claim that payee signed, and only inside a budget an Arc contract enforces.
            Then it writes each payment into the books you already keep.
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
        </div>

        <div>
          <div className="ticket">
            <div className="head">
              <div>
                <div className="amount">{SAMPLE.amount} USDC</div>
                <span className="hint">
                  to <span className="mono">{short(SAMPLE.payout)}</span>
                </span>
              </div>
              <span className="chip PAY">PAID ON ARC</span>
            </div>
            <ul>
              <li>
                <span className="ok">✓</span>
                <span>
                  The payee proved this address
                  <small>
                    signed with it, once: <a href={explorerTx(SAMPLE.proofTx)}>{short(SAMPLE.proofTx)}</a>
                  </small>
                </span>
              </li>
              <li>
                <span className="ok">✓</span>
                <span>
                  The payee signed this claim
                  <small>one invoice, one amount, paid once</small>
                </span>
              </li>
              <li>
                <span className="ok">✓</span>
                <span>
                  Inside the budget
                  <small>checked by the contract, not by the AI</small>
                </span>
              </li>
              <li>
                <span className="ok">✓</span>
                <span>
                  A person co-signed
                  <small>every first payment to a new address waits for one</small>
                </span>
              </li>
              <li>
                <span className="ok">✓</span>
                <span>
                  The agent&apos;s decision is anchored
                  <small>
                    hash-chained, replayable: <a href={explorerTx(SAMPLE.anchorTx)}>{short(SAMPLE.anchorTx)}</a>
                  </small>
                </span>
              </li>
            </ul>
            <div className="foot">
              <a href={`/receipt?tx=${SAMPLE.tx}`}>Open the receipt</a>
              <span>A real payment on Arc testnet, from our own tests.</span>
            </div>
          </div>
          <div className="ticket refused">
            <ul>
              <li>
                <span className="no">✗</span>
                <span>
                  The same claim to a look-alike address
                  <small>
                    refused by the contract, not by our server. <a href="/try">See it happen</a>
                  </small>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Where stablecoin payouts go wrong</h2>
        <p className="sub">
          A payment to the wrong wallet balances perfectly in the books. Nothing catches it afterwards, so it has to be
          caught before the money moves.
        </p>
        <div className="cards">
          <div className="card">
            <span className="tag stop">Look-alike address</span>
            <h3>Copied from history</h3>
            <p>
              An attacker sends dust from an address with the same first and last characters as your contractor&apos;s.
              SendSure pays only the address the contractor proved by signing with it.
            </p>
          </div>
          <div className="card">
            <span className="tag stop">&ldquo;We changed wallets&rdquo;</span>
            <h3>The email that redirects a payment</h3>
            <p>
              Changing a payout address needs the old wallet, the new wallet and a waiting period you can cancel. An email
              cannot do it, and neither can the agent.
            </p>
          </div>
          <div className="card">
            <span className="tag stop">Forged or repeated invoice</span>
            <h3>Paid twice, or paid to a stranger</h3>
            <p>
              Every invoice is a claim the payee signed. A forged one cannot carry their signature, and one invoice is one
              payment, enforced on-chain.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>How it works</h2>
        <p className="sub">You only sign. SendSure pays the gas, and the money never leaves your own wallet until a payment is due.</p>
        <div className="cards numbered">
          <div className="card">
            <h3>Each payee proves their address, once</h3>
            <p>You send an invite link from your own email. The payee signs with their wallet, and that address is theirs on Arc.</p>
          </div>
          <div className="card">
            <h3>Payees sign a claim for every invoice</h3>
            <p>
              Or you upload the invoice and Claude reads it, showing the exact words each value came from. The payee checks it
              and signs.
            </p>
          </div>
          <div className="card">
            <h3>The agent checks every claim</h3>
            <p>
              It runs the contract&apos;s own dry run, then Claude reviews the run. Anything unusual is held with a plain
              reason, and a person co-signs first payments and large ones.
            </p>
          </div>
          <div className="card">
            <h3>It pays, and your books match</h3>
            <p>
              USDC moves from your wallet through the contract. Each payment gets a public receipt and lands in your books,
              exact to the last decimal.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Works with the books you already keep</h2>
        <p className="sub">
          A ledger checks that debits equal credits. It does not check who was paid, and some round a small difference away
          without telling you. SendSure records the exact amount from the chain, with the Arc transaction, once.
        </p>
        <div className="split">
          <div className="cards" style={{ gridTemplateColumns: "1fr" }}>
            <div className="card">
              <span className="tag">Add-on · live run 25/25</span>
              <h3>Odoo 19</h3>
              <p>
                &ldquo;Pay with SendSure&rdquo; on a vendor bill. Odoo trusts only the wallet the vendor proved, and each
                payment is recorded through Odoo&apos;s own Register Payment. Half a cent is never rounded away.
              </p>
            </div>
            <div className="card">
              <span className="tag">App · live run 29/29</span>
              <h3>ERPNext 15</h3>
              <p>
                &ldquo;Pay with SendSure&rdquo; on a purchase invoice. The supplier&apos;s proven address is read from Arc and cannot
                be typed in, and each payment is recorded as a Payment Entry with the transaction as its reference.
              </p>
            </div>
            <div className="card">
              <span className="tag">Checked by the tools themselves</span>
              <h3>beancount and hledger</h3>
              <p>
                Plain-text books with every payment, its claim and its transaction, and the treasury balance asserted from
                the chain. They pass <span className="mono">bean-check</span> and <span className="mono">hledger check</span>.
              </p>
            </div>
            <div className="card">
              <span className="tag">Any other ledger</span>
              <h3>Journal and statement CSV</h3>
              <p>A balanced general journal, and a bank-statement file with the Arc transaction as the reference.</p>
              <a className="more" href="/books">
                See every format and download a sample →
              </a>
            </div>
          </div>
          <a href="/books">
            <img
              className="shot"
              src="/books/odoo-bill-paid-on-arc.jpg"
              alt="An Odoo vendor bill paid with SendSure: the payment is recorded with the exact USDC amount and the Arc transaction"
              width={1018}
              height={762}
              loading="lazy"
            />
          </a>
        </div>
      </section>

      <section className="section">
        <h2>Who it is for</h2>
        <div className="cards">
          <div className="card">
            <h3>Teams that pay in USDC</h3>
            <p>
              Agencies, DAOs, grant programs and startups paying contractors or vendors. Set a budget once; approve only what
              needs a person.
            </p>
            <a className="more" href="/org">
              Set up your team →
            </a>
          </div>
          <div className="card">
            <h3>The people being paid</h3>
            <p>Confirm your address once, in a minute, for free. After that nobody can redirect your payment with an email.</p>
            <a className="more" href="/verify">
              For payees →
            </a>
          </div>
          <div className="card">
            <h3>Whoever keeps the books</h3>
            <p>Every payment arrives with its invoice, its transaction and its receipt, in Odoo, in ERPNext or in the ledger format you use.</p>
            <a className="more" href="/books">
              Books →
            </a>
          </div>
          <div className="card">
            <h3>Other agents</h3>
            <p>
              An MCP server, and paid checks over Circle Gateway (x402): $0.001 to verify a payee, $0.005 to check a payout
              file.
            </p>
            <a className="more" href="/api/x402">
              Catalog →
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Three rules the AI cannot skip</h2>
        <p className="sub">The model can hold a payment or ask a person. It can never make the contract pay.</p>
        <div className="cards">
          <div className="card">
            <h3>The payee proved their address.</h3>
            <p>They signed with it. Changing it needs the old key, the new key and a waiting period.</p>
          </div>
          <div className="card">
            <h3>The payee signed this claim.</h3>
            <p>A forged invoice cannot carry their signature, and an invoice is never paid twice.</p>
          </div>
          <div className="card">
            <h3>A contract enforces the budget.</h3>
            <p>Limits start at zero. New payees and large amounts need a human co-sign on-chain.</p>
          </div>
        </div>
      </section>

      <section className="section band">
        <h2 style={{ marginTop: 0 }}>Live on Arc testnet, and checkable</h2>
        <ul>
          <li>
            <a href="/dashboard">Dashboard</a>: every number counted from chain events, with sandbox activity kept out of the
            traction count.
          </li>
          <li>
            A <a href={`/receipt?tx=${SAMPLE.tx}`}>payment receipt</a>: the payee&apos;s proof of address, their signed claim, and the
            agent&apos;s anchored decision.
          </li>
          <li>
            PayeeRegistry <a className="mono" href={explorerAddress(deployment.payeeRegistry)}>{deployment.payeeRegistry}</a> ·
            MandateFactory <a className="mono" href={explorerAddress(deployment.mandateFactory)}>{deployment.mandateFactory}</a>
          </li>
          <li>
            Built on Circle and Arc: USDC, contracts on Arc, a Circle agent wallet that can send the payments, and Circle
            Gateway for paid checks.
          </li>
          <li>
            For agents: <span className="mono">claude mcp add --transport http sendsure https://sendsure.0xpankaj.workers.dev/api/mcp</span>
          </li>
          <li>
            <a href={REPO}>Source and test runs</a> (MIT). <a href="/status">System status</a>. Testnet only; not audited.
          </li>
        </ul>
      </section>
    </>
  );
}
