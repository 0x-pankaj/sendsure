import type { Metadata } from "next";
import { DemoBooks } from "../../components/DemoBooks";

export const metadata: Metadata = {
  title: "SendSure: books",
  description: "Every SendSure payment lands in the books you already keep: Odoo, beancount, hledger or CSV, exact to the last decimal.",
};

const REPO = "https://github.com/0x-pankaj/sendsure/blob/main";

export default function BooksPage() {
  return (
    <>
      <p className="eyebrow">Books</p>
      <h1>Your books, exact to the last decimal</h1>
      <p className="lede">
        A ledger checks that debits equal credits. A payment to the wrong wallet balances perfectly, and a half-cent
        difference can vanish into rounding. SendSure writes each payment into the books you already keep, with the exact
        amount from the chain and the Arc transaction, once.
      </p>

      <section className="section" style={{ marginTop: 28 }}>
        <h2>What SendSure never does in your books</h2>
        <div className="cards">
          <div className="card">
            <span className="tag stop">Never rounded</span>
            <h3>Six decimals, always</h3>
            <p>A settlement is recorded only if it equals the open amount to the last of 6 decimals. Anything else stays open for a person.</p>
          </div>
          <div className="card">
            <span className="tag stop">Never twice</span>
            <h3>One transaction, one entry</h3>
            <p>Each Arc transaction can be recorded once. Syncing again changes nothing.</p>
          </div>
          <div className="card">
            <span className="tag stop">Never without proof</span>
            <h3>No transaction, no payment</h3>
            <p>In Odoo and ERPNext, a USDC payment entered by hand, without an Arc transaction to the proven address, is refused.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Odoo 19</h2>
        <p className="sub">
          An add-on for Odoo Community. It was tested inside Odoo (28 tests) and end to end: a real Odoo bill paid on Arc
          testnet and recorded back, 27 of 27 checks.
        </p>
        <div className="split">
          <div>
            <img
              className="shot"
              src="/books/odoo-bill-paid-on-arc.jpg"
              alt="An Odoo vendor bill paid with SendSure, recorded with the exact USDC amount and the Arc transaction"
              width={1018}
              height={762}
              loading="lazy"
            />
            <p className="hint">A vendor bill paid on Arc, recorded through Odoo&apos;s own Register Payment.</p>
          </div>
          <div>
            <img
              className="shot"
              src="/books/odoo-vendor-proven-wallet.jpg"
              alt="An Odoo vendor: the wallet the vendor proved is trusted, a wallet someone added is refused"
              width={1018}
              height={762}
              loading="lazy"
            />
            <p className="hint">The wallet the vendor proved can be trusted. A wallet someone slipped in cannot, even by the admin.</p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Odoo alone (we reproduced each on Odoo 19)</th>
                <th>With the SendSure add-on</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>The built-in &ldquo;Manual&rdquo; method pays an untrusted wallet.</td>
                <td>The USDC journal&apos;s only way out is SendSure, which needs a trusted wallet and an Arc transaction.</td>
              </tr>
              <tr>
                <td>Anyone with the right can trust any wallet someone typed in.</td>
                <td>A wallet can be trusted only if it is the address the vendor proved, read from Arc at that moment.</td>
              </tr>
              <tr>
                <td>A $250.00 bill paid with 249.995 USDC is marked paid, with no write-off.</td>
                <td>Recorded only if it matches exactly. Otherwise the bill stays open with a note.</td>
              </tr>
              <tr>
                <td>The currency code USDC is cut to USD, which already exists.</td>
                <td>USDC is set up with 6 decimals at 1:1 to USD.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">
          One command with Docker: <span className="mono">./run.sh up</span> in{" "}
          <a href={`${REPO}/integrations/odoo`}>integrations/odoo</a>. The key Odoo uses can send bills and read their status.
          It can never approve, co-sign or change your rules.
        </p>
      </section>

      <section className="section">
        <h2>ERPNext 15</h2>
        <p className="sub">
          A Frappe app. It was tested inside ERPNext (25 tests) and end to end: a real ERPNext purchase invoice paid on Arc
          testnet and recorded back, 29 of 29 checks.
        </p>
        <div className="split">
          <div>
            <img
              className="shot"
              src="/books/erpnext-invoice-paid-on-arc.jpg"
              alt="An ERPNext purchase invoice paid with SendSure: 0.250000 USDC with the Arc transaction and a link to the receipt"
              width={1425}
              height={1100}
              loading="lazy"
            />
            <p className="hint">A purchase invoice paid on Arc, recorded as a Payment Entry with the transaction as its reference.</p>
          </div>
          <div>
            <img
              className="shot"
              src="/books/erpnext-supplier-proven-address.jpg"
              alt="An ERPNext supplier: the proven payout address is read from SendSure and cannot be typed in"
              width={1425}
              height={1100}
              loading="lazy"
            />
            <p className="hint">The proven address is read from SendSure. Typing another one is refused, for the administrator too.</p>
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>ERPNext alone (we reproduced each on ERPNext 15.121.6)</th>
                <th>With the SendSure app</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>A 250.00 invoice paid with 249.995 is marked Paid: both ledger rows say 250.00, no Round Off row, no write-off.</td>
                <td>A settlement is recorded only if it equals the open amount exactly, to the last of 6 decimals; the ledger rows are read back after posting.</td>
              </tr>
              <tr>
                <td>A supplier&apos;s bank account number takes 30 characters; a wallet address has 42.</td>
                <td>The proven address is a read-only field read from SendSure. Only an Accounts Manager can approve it for payments.</td>
              </tr>
              <tr>
                <td>A Payment Entry takes any text as its reference; nothing ties it to a transfer.</td>
                <td>A payment on the SendSure mode, or out of the USDC account, is refused unless SendSure read the settlement from Arc.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint">
          One command with Docker: <span className="mono">./run.sh up</span> in{" "}
          <a href={`${REPO}/integrations/erpnext`}>integrations/erpnext</a>. The same key rules as Odoo: it can send invoices
          and read their status, never approve, co-sign or change your rules.
        </p>
      </section>

      <section className="section">
        <h2>Plain-text and CSV books</h2>
        <p className="sub">
          Every payment carries its claim, the agent&apos;s decision hash and its Arc transaction. After each payment day the
          treasury balance is asserted from the chain, and anything that moved the treasury outside SendSure is one explicit
          entry, computed from that balance.
        </p>
        <div className="cards">
          <div className="card">
            <span className="tag">bean-check passes</span>
            <h3>beancount</h3>
            <p>Six-decimal USDC with an explicit tolerance of one millionth, and a balance assertion per payment day.</p>
          </div>
          <div className="card">
            <span className="tag">hledger check --strict passes</span>
            <h3>hledger</h3>
            <p>A journal with declared accounts and a balance assertion per day. hledger refuses the file if the balance is off by 0.000001.</p>
          </div>
          <div className="card">
            <span className="tag">Debits equal credits</span>
            <h3>Journal CSV</h3>
            <p>A general journal, two lines per entry, for any ledger that imports journal lines, or for a spreadsheet.</p>
          </div>
          <div className="card">
            <span className="tag">Nets to the chain balance</span>
            <h3>Bank-statement CSV</h3>
            <p>
              Date, amount, payee, description and the Arc transaction as the reference, for tools that reconcile from a
              statement. Amounts keep six decimals; the download tells you which ones a cents-only tool would round.
            </p>
          </div>
        </div>
        <div className="band" style={{ marginTop: 16 }}>
          <b>Download a sample</b>
          <p className="hint" style={{ marginTop: 4 }}>
            The books of the public demo org (a sandbox: our own test payments on Arc testnet), read from the chain right now.
          </p>
          <DemoBooks />
        </div>
        <p className="hint">
          Your own team&apos;s books are in <a href="/org">/org</a> under &ldquo;Your books&rdquo;. Payee names are added in your
          browser; they never reach our server. The writers: <a href={`${REPO}/packages/core/src/beancount.ts`}>beancount.ts</a>,{" "}
          <a href={`${REPO}/packages/core/src/ledgers.ts`}>ledgers.ts</a>.
        </p>
      </section>
    </>
  );
}
