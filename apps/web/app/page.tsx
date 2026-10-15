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
      {/* ------------------------------------------------------------ hero */}
      <section className="hero bleed bleed-glow">
        <div>
          <p className="eyebrow">Payables agent · USDC on Arc</p>
          <h1>
            Pay only the <em>right person</em>.
          </h1>
          <p className="lede">
            A fake supplier&apos;s invoice, or an email saying &ldquo;we changed our bank details&rdquo;, can send your money to
            a stranger, and the books still balance. SendSure pays each supplier in USDC only at the wallet they proved, only
            for a bill they signed from it. Claude checks every bill, and a person co-signs anything new.
          </p>
          <div className="cta">
            <a className="btn lg" href="/org">
              Set up your team
            </a>
            <a className="btn secondary lg" href="/check">
              Check a payout, free
            </a>
          </div>
          <div className="reassure">
            <span>Pays from your own wallet</span>
            <span>Gas paid for you</span>
            <span>Open source</span>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            Just looking? <a href="/try">Try it in two minutes, no wallet needed</a>.
          </p>
        </div>

        <div className="stage">
          <div className="float a">
            <span className="dot green">✓</span>
            <span>
              Address proven
              <small>signed by the payee, once</small>
            </span>
          </div>
          <div className="ticket">
            <div className="head">
              <div>
                <div className="amount">{SAMPLE.amount} USDC</div>
                <span className="hint">
                  to <span className="mono">{short(SAMPLE.payout)}</span>
                </span>
              </div>
              <span className="chip PAY">Paid on Arc</span>
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
              <a href={`/receipt?tx=${SAMPLE.tx}`}>Open the receipt →</a>
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
          <div className="float b">
            <span className="dot purple">AI</span>
            <span>
              Reviewed by Claude
              <small>it can hold a payment, never make one</small>
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ built on */}
      <section className="trust" aria-label="Built on">
        <div className="label">Built on and works with</div>
        <div className="logos">
          <span>Arc</span>
          <span>USDC</span>
          <span>Circle Gateway</span>
          <span>Circle Wallets</span>
          <span>Claude</span>
          <span>Odoo</span>
          <span>ERPNext</span>
          <span>beancount</span>
        </div>
      </section>

      {/* ------------------------------------------------------------ the problem */}
      <section className="section center">
        <h2>The fraud that looks like a normal bill</h2>
        <p className="sub">
          Google and Facebook paid over $100 million to a man posing as their real supplier, Quanta Computer. The invoices
          looked right; the bank account was his (
          <a href="https://www.theregister.com/2019/03/21/facebook_google_scam/">The Register, 2019</a>). A payment like that
          balances perfectly in the books, so SendSure stops it before the money moves.
        </p>
        <div className="cards" style={{ textAlign: "left" }}>
          <div className="card">
            <span className="tag stop">&ldquo;We changed our bank details&rdquo;</span>
            <h3>The email that redirects a payment</h3>
            <p>
              Changing a payout address needs the old wallet, the new wallet and a waiting period you can cancel. An email
              cannot do it, and neither can the agent.
            </p>
          </div>
          <div className="card">
            <span className="tag stop">Fake supplier</span>
            <h3>A bill from someone posing as your supplier</h3>
            <p>
              A bill is paid only to the wallet that supplier proved, and only once they sign it from that wallet. A new
              supplier&apos;s first payment waits for a person to co-sign.
            </p>
          </div>
          <div className="card">
            <span className="tag stop">Odd or repeated bill</span>
            <h3>Paid twice, or more than it should be</h3>
            <p>
              One invoice is one payment, enforced on-chain. Claude checks every bill for the same work billed twice, an
              amount far above normal, or a note asking to hurry. It can hold a payment, never make one.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ features */}
      <section className="feature">
        <div className="panel mint" aria-hidden="true">
          <div className="mini">
            <div className="t">Confirm your payout address</div>
            <div className="s">Pankaj Studio wants to pay you through SendSure.</div>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="pill">Create a passkey wallet</span>
              <span className="s">Face ID · gas paid by Circle</span>
            </div>
          </div>
          <div className="mini offset">
            <div className="line">
              <span className="t">0x43Aa…191e</span>
              <span className="chip PAY">Proven</span>
            </div>
            <div className="line">
              <span className="s">Change of address</span>
              <span className="s">old key + new key + waiting period</span>
            </div>
          </div>
          <div className="mini">
            <div className="line">
              <span className="t">0x43Ab…191e</span>
              <span className="chip STOP">Refused on-chain</span>
            </div>
          </div>
        </div>
        <div>
          <p className="eyebrow">Verification of payee</p>
          <h3>Every payee proves their own address</h3>
          <p>Banks in the EU had to add payee verification in 2025. Stablecoin payouts had nothing like it. Now they do.</p>
          <ul className="checks">
            <li>
              <span>
                <b>Signed once</b> with their own wallet, or with a passkey if they have no wallet app.
              </span>
            </li>
            <li>
              <span>
                <b>Changing it</b> needs the old key, the new key and a waiting period you can cancel.
              </span>
            </li>
            <li>
              <span>
                <b>Look-alikes and forged claims</b> are refused by the contract on Arc, not by our server.
              </span>
            </li>
          </ul>
          <a className="btn secondary" href="/try">
            See it in the two-minute demo
          </a>
        </div>
      </section>

      <section className="feature flip">
        <div className="panel lilac" aria-hidden="true">
          <div className="mini">
            <div className="line">
              <span>
                <span className="t">INV-041</span> <span className="s">0.25 USDC</span>
              </span>
              <span className="chip PAY">Pay</span>
            </div>
            <div className="line">
              <span>
                <span className="t">INV-042</span> <span className="s">&ldquo;pay my new wallet, urgent&rdquo;</span>
              </span>
              <span className="chip REVIEW">Ask a person</span>
            </div>
            <div className="line">
              <span>
                <span className="t">INV-043</span> <span className="s">same work billed twice</span>
              </span>
              <span className="chip STOP">Hold</span>
            </div>
          </div>
          <div className="mini offset">
            <div className="s">Rules first, then Claude Opus 5.5 with read-only tools</div>
            <div className="t" style={{ marginTop: 4 }}>Every decision hash-chained and anchored on Arc</div>
          </div>
        </div>
        <div>
          <p className="eyebrow">The agent</p>
          <h3>An agent that can say no. A contract that decides yes.</h3>
          <p>It runs your payables every day and explains every decision in plain words.</p>
          <ul className="checks">
            <li>
              <span>
                <b>The contract&apos;s own check</b> runs first; Claude reviews anything unusual.
              </span>
            </li>
            <li>
              <span>
                <b>It can hold a payment, never make one</b> the contract would refuse.
              </span>
            </li>
            <li>
              <span>
                <b>First payments and large ones</b> wait for a person&apos;s co-sign, on-chain.
              </span>
            </li>
            <li>
              <span>
                <b>Cash short?</b> The oldest work is paid first. Autopilot runs it whenever something changes.
              </span>
            </li>
          </ul>
          <a className="btn secondary" href="/org">
            Set up your team
          </a>
        </div>
      </section>

      <section className="feature">
        <div className="panel sky" aria-hidden="true">
          <div className="mini">
            <div className="s">Odoo · BILL/2026/10/0004</div>
            <div className="line">
              <span className="t">Paid on Arc with SendSure</span>
              <span className="chip PAY">0.250000 USDC</span>
            </div>
            <div className="line">
              <span className="s">Memo</span>
              <span className="mono s">SendSure 0x9dca0b31…</span>
            </div>
          </div>
          <div className="mini offset">
            <div className="line">
              <span className="t">ERPNext · Payment Entry</span>
              <span className="chip PAY">Paid</span>
            </div>
            <div className="line">
              <span className="s">beancount · hledger · CSV</span>
              <span className="s">bean-check ✓ · hledger --strict ✓</span>
            </div>
          </div>
        </div>
        <div>
          <p className="eyebrow">Books</p>
          <h3>Payments land in the books you already keep</h3>
          <p>
            A ledger checks that debits equal credits, not who was paid, and some round a small difference away without
            telling you. SendSure records the exact amount from the chain, with the transaction, once.
          </p>
          <ul className="checks">
            <li>
              <span>
                <b>Odoo 16–19:</b> trusts only the vendor&apos;s proven wallet; payments come back through Register Payment.
              </span>
            </li>
            <li>
              <span>
                <b>ERPNext 15–16:</b> a payment is recorded only if it matches the invoice exactly.
              </span>
            </li>
            <li>
              <span>
                <b>beancount, hledger and CSV</b>, exact to six decimals, each checked by the tool it is for.
              </span>
            </li>
          </ul>
          <a className="btn secondary" href="/books">
            See every format
          </a>
        </div>
      </section>

      <section className="feature flip">
        <div className="panel sand" aria-hidden="true">
          <div className="mini">
            <div className="line">
              <span className="t">Acme Design (new wallet!)</span>
              <span className="chip STOP">Look-alike</span>
            </div>
            <div className="line">
              <span className="t">Bob Writer</span>
              <span className="chip REVIEW">Changed</span>
            </div>
            <div className="line">
              <span className="t">Dan Video · INV-14</span>
              <span className="chip STOP">Billed twice</span>
            </div>
            <div className="line">
              <span className="t">Acme Design Ltd</span>
              <span className="chip PAY">Same as last time</span>
            </div>
          </div>
          <div className="mini offset">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="s">Then, if you ask</span>
              <span className="pill">Review with Claude</span>
            </div>
          </div>
        </div>
        <div>
          <p className="eyebrow">Free payout check</p>
          <h3>Check any payout before you send it</h3>
          <p>Address poisoning plants look-alike addresses in your history and waits for your next copy and paste. Check your list first.</p>
          <ul className="checks">
            <li>
              <span>
                <b>Free, in your browser.</b> Your file is never uploaded.
              </span>
            </li>
            <li>
              <span>
                <b>Look-alikes, changed wallets, duplicates</b> and amount jumps, against the last run you paid.
              </span>
            </li>
            <li>
              <span>
                <b>Claude can review the run</b> line by line, and only ever makes a line stricter.
              </span>
            </li>
          </ul>
          <a className="btn secondary" href="/check?example">
            Try it with the example file
          </a>
        </div>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section className="section">
        <p className="eyebrow">How it works</p>
        <h2>You only sign. SendSure does the rest.</h2>
        <p className="sub">SendSure pays the gas, and the money never leaves your own wallet until a payment is due.</p>
        <div className="cards numbered">
          <div className="card">
            <h3>Each payee proves their address, once</h3>
            <p>You send an invite link from your own email. The payee signs with their wallet or a passkey, and that address is theirs on Arc.</p>
          </div>
          <div className="card">
            <h3>Payees sign a claim for every invoice</h3>
            <p>Or you upload the invoice and Claude reads it, showing the exact words each value came from. The payee checks it and signs.</p>
          </div>
          <div className="card">
            <h3>The agent checks every claim</h3>
            <p>The contract&apos;s own dry run, then Claude. Anything unusual is held with a plain reason; first and large payments need a person.</p>
          </div>
          <div className="card">
            <h3>It pays, and your books match</h3>
            <p>USDC moves from your wallet through the contract. Each payment gets a public receipt and lands in your books, exact.</p>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 20 }}>
          <a href="/docs">Read the full guide</a>: every step, who can move money, and how to use it for each role.
        </p>
      </section>

      {/* ------------------------------------------------------------ who it is for */}
      <section className="section">
        <p className="eyebrow">Who it is for</p>
        <h2>For everyone around a payout</h2>
        <div className="cards" style={{ marginTop: 28 }}>
          <div className="card">
            <h3>Teams that pay in USDC</h3>
            <p>Agencies, DAOs, grant programs and startups paying contractors or vendors. Set a budget once; approve only what needs a person.</p>
            <a className="more" href="/org">
              Set up your team →
            </a>
          </div>
          <div className="card">
            <h3>The people being paid</h3>
            <p>Confirm your address once, in a minute, for free, even without a wallet app. After that nobody can redirect your pay with an email.</p>
            <a className="more" href="/verify">
              For payees →
            </a>
          </div>
          <div className="card">
            <h3>Whoever keeps the books</h3>
            <p>Every payment arrives with its invoice, its transaction and its receipt, in Odoo, in ERPNext or in your ledger format.</p>
            <a className="more" href="/books">
              Books →
            </a>
          </div>
          <div className="card">
            <h3>Other agents</h3>
            <p>An MCP server, and paid checks over Circle Gateway (x402): $0.001 to verify a payee, $0.005 to check a payout file.</p>
            <a className="more" href="/api/x402">
              Catalog →
            </a>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ proof */}
      <section className="section">
        <p className="eyebrow">Live on Arc testnet</p>
        <h2>Checkable, end to end</h2>
        <p className="sub">
          Every number on the <a href="/dashboard">dashboard</a> is counted from chain events, with our own tests kept apart from
          traction. Every claim in the repo links to a test or a live run.
        </p>
        <div className="stats">
          <div className="stat">
            <b>16</b>
            <span>live test suites against this site</span>
          </div>
          <div className="stat">
            <b>47</b>
            <span>contract tests</span>
          </div>
          <div className="stat">
            <b>37</b>
            <span>tests inside Odoo 16 to 19</span>
          </div>
          <div className="stat">
            <b>29</b>
            <span>tests inside ERPNext 15 and 16</span>
          </div>
        </div>
        <div className="split" style={{ marginTop: 22 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>See for yourself</h3>
            <ul className="checks" style={{ marginBottom: 0 }}>
              <li>
                <span>
                  A <a href={`/receipt?tx=${SAMPLE.tx}`}>payment receipt</a>: proof of address, the signed claim, the anchored decision.
                </span>
              </li>
              <li>
                <span>
                  PayeeRegistry <a className="mono" href={explorerAddress(deployment.payeeRegistry)}>{short(deployment.payeeRegistry)}</a> and
                  MandateFactory <a className="mono" href={explorerAddress(deployment.mandateFactory)}>{short(deployment.mandateFactory)}</a>, source-verified.
                </span>
              </li>
              <li>
                <span>
                  <a href={REPO}>Source and every test run</a> (MIT) · <a href="/status">system status</a> · testnet only, not audited.
                </span>
              </li>
            </ul>
          </div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>For your agent</h3>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>Connect over MCP, or buy checks per call with USDC over Circle Gateway.</p>
            <div className="mono-box">claude mcp add --transport http sendsure https://sendsure.0xpankaj.workers.dev/api/mcp</div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ call to action */}
      <section className="cta-band">
        <h2>Check your next payout before you send it</h2>
        <p>Free, in your browser, nothing uploaded. Or set up your team on Arc testnet in ten minutes; we can do it with you on a call.</p>
        <div className="row">
          <a className="btn lg" href="/check">
            Check a payout
          </a>
          <a className="btn secondary lg" href="/org">
            Set up your team
          </a>
        </div>
      </section>
    </>
  );
}
