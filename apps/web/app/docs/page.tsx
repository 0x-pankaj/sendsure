import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SendSure: how it works",
  description:
    "The SendSure guide: the problem, the three rules, how a payment moves, who can move money, and step-by-step use for payers, payees, Odoo and ERPNext, and agents.",
};

const REPO = "https://github.com/0x-pankaj/sendsure";
const SITE = "https://sendsure.0xpankaj.workers.dev";

const TOC: [string, string][] = [
  ["short", "The short version"],
  ["problem", "The problem"],
  ["rules", "The three rules"],
  ["flow", "How a payment moves"],
  ["parts", "Every part"],
  ["safety", "Who can move money"],
  ["attacks", "Attacks and what stops them"],
  ["use", "How to use it"],
  ["why", "Why use it"],
  ["circle", "Built on Circle and Arc"],
  ["proof", "Proof"],
  ["faq", "Questions"],
  ["glossary", "Glossary"],
  ["links", "Contracts and links"],
];

const FLOW: { who: string; title: string; body: React.ReactNode }[] = [
  {
    who: "Payer",
    title: "Create the team's org",
    body: (
      <>
        Connect the wallet that holds the team&apos;s USDC and sign once. SendSure creates the team&apos;s own contract (a
        Mandate) on Arc and pays the gas. A new wallet can take 2 test USDC from the built-in faucet.
      </>
    ),
  },
  {
    who: "Payer",
    title: "Sign a budget",
    body: <>A USDC permit: the org may move at most this much from your wallet, and only through its rules. Signing is free. Set it to 0 to stop every payment at once.</>,
  },
  {
    who: "Payer",
    title: "Invite the people you pay",
    body: <>Type their names and SendSure makes one invite link each. Send it from your own email or chat, so they know it is really you. Names stay in your browser, never on-chain.</>,
  },
  {
    who: "Payee",
    title: "Prove the payout address",
    body: <>The payee opens the link, connects their wallet (or creates a passkey wallet) and signs once. That address is now theirs for this payer, recorded on Arc. Gas is paid for them.</>,
  },
  {
    who: "Payee or payer",
    title: "Turn each invoice into a signed claim",
    body: (
      <>
        The payee enters the invoice number, amount and work period, and signs. Or the payer pastes the invoice (or a photo)
        and Claude reads it, quoting where each value came from; the payee checks and signs. Or Odoo or ERPNext sends the bill.
      </>
    ),
  },
  {
    who: "Agent",
    title: "Check every claim",
    body: (
      <>
        The agent runs the contract&apos;s own dry run, adds red flags from the payee&apos;s history (the same amount twice,
        overlapping dates, &quot;pay my new wallet&quot;), then asks Claude. It decides pay, ask a person, or hold, with a plain reason.
      </>
    ),
  },
  {
    who: "Approver",
    title: "Co-sign where a person must",
    body: <>The first payment to a new address, and anything above the co-sign limit, waits for a person to co-sign that exact claim on-chain. One click in SendSure, or from Odoo.</>,
  },
  {
    who: "Agent and contract",
    title: "Pay, from the team's own wallet",
    body: (
      <>
        The agent calls <code>settle()</code>. The contract checks all three rules again and moves USDC straight from the
        payer&apos;s wallet to the proven address. If cash is short, the oldest work is paid first. With autopilot on, this
        happens by itself when something changes.
      </>
    ),
  },
  {
    who: "Everyone",
    title: "Receipt and books",
    body: <>A public receipt appears. The payment is recorded in the team&apos;s books with the transaction: Odoo through its own Register Payment, ERPNext as a Payment Entry, or a ledger file. Notices can go to Discord or Slack.</>,
  },
];

const PARTS: [string, string, string][] = [
  ["PayeeRegistry (contract)", "Stores which address each payee proved, per payer. A change needs the old key, the new key and a waiting period.", "The address comes from the payee, not from a list someone can edit."],
  ["Mandate (one contract per team)", "Holds the team's rules: budget, caps, co-sign limit, approvers, agents. settle() pays only when every rule passes; anchor() records the decision log.", "The rules are enforced on-chain. Nobody can talk their way past them."],
  ["Relayer", "Checks each signature, then sends it to Arc and pays the gas.", "Payers and payees only sign. No gas or crypto knowledge needed to start."],
  ["The agent", "Dry-runs every claim, flags risks, asks Claude, plans cash (oldest work first), settles and anchors.", "Payables run every day without someone babysitting a wallet."],
  ["Claude review", "Reads unusual claims with read-only tools and explains its decision. It can only make a decision stricter.", "Catches what fixed rules miss, like “urgent, pay my new wallet” inside an invoice."],
  ["Autopilot", "Every minute, checks whether anything changed (a new claim, a co-sign, new funds) and runs the agent only then.", "Payments happen on time without anyone pressing a button."],
  ["Decision log and anchors", "Every decision is hash-chained, the head is anchored on Arc, and each payment carries its decision's hash.", "Anyone can replay why a payment was made; edits to the log are detectable."],
  ["Invoice reader", "Claude reads a pasted invoice or a photo and quotes the exact words for each value. The quotes are checked in code.", "No retyping, and the AI cannot invent an amount without being caught."],
  ["Odoo 19 add-on", "Pay with SendSure on a vendor bill; only the vendor's proven wallet can be trusted; payments come back through Register Payment; email the invite; co-sign links; filters.", "Teams keep working in Odoo, and their books stay exact."],
  ["ERPNext 15 app", "The same for purchase invoices: proven address read-only, Accounts Manager approval, a Payment Entry only when the amount matches exactly.", "The same safety for ERPNext teams."],
  ["Ledger exports", "beancount, hledger, journal CSV and bank-statement CSV, exact to 6 decimals, with balances checked against the chain.", "Works with any accounting tool."],
  ["Free payout check", "Paste a payout CSV; it flags look-alikes, changed wallets, duplicates and amount jumps against the last run. Runs in your browser.", "Useful on day one, before anyone signs up."],
  ["Shadow review", "On the payout check, Claude reviews a real payout run line by line and you mark where you agree. Nothing is paid.", "Test the agent on real data with zero risk."],
  ["Passkey wallets", "A payee with no wallet app gets a Circle smart account protected by Face ID, a fingerprint or a PIN. Gas is paid by Circle Gas Station.", "Removes the biggest drop-off: “I don't have a wallet.”"],
  ["Paid checks (x402) and MCP", "Other AI agents verify a payee ($0.001) or check a payout file ($0.005), paid in USDC over Circle Gateway, or connect over MCP.", "Agents paying agents: the check becomes a service."],
  ["Dashboard, receipts, faucet, status", "Live numbers counted from chain events, with outside teams, our own team and our tests kept apart; public receipts; 2 test USDC for new wallets; system health.", "Everything is checkable, and new users are never stuck."],
];

const ROLES: [string, string, string][] = [
  ["Treasury (the payer's own wallet)", "Hold the money; set or revoke the budget.", "Be paid by its own org."],
  ["Owner", "Set caps, agents and approvers; invite; freeze or revoke payees; pause; turn autopilot on.", "Change a payee's address or sign their claim."],
  ["Approver", "Co-sign one exact claim; pause; freeze; cancel an address change; turn autopilot off.", "Send money."],
  ["Agent", "Call settle(), which pays only if every rule passes; anchor the log.", "Change caps, payees or addresses; pay an unproven address or an unsigned claim; skip a co-sign."],
  ["Claude", "Hold or escalate a claim, with reasons.", "Pay, add payees, change amounts, or overrule a person."],
  ["Payee", "Prove their address; sign claims; change address with both keys and a wait.", "Get paid outside the caps, the budget or a required co-sign."],
  ["Relayer key", "Pay gas for signatures it checked.", "Anything else. It has no role in any contract."],
  ["Odoo or ERPNext key", "Send bills, read status, ask the agent to run.", "Approve, co-sign, add payees or change rules."],
];

const ATTACKS: [string, string][] = [
  ["A look-alike address", "The free check flags it; the contract only pays the address the payee proved."],
  ["“Please pay my new wallet”", "A change needs the old key and the new key, then a waiting period the payer can cancel. The agent holds claims that ask for it."],
  ["A wallet slipped onto a vendor in Odoo or ERPNext", "Only the address the vendor proved can be trusted, even by the admin."],
  ["A forged invoice", "A claim must be signed by the payee's proven key; the contract refuses anything else."],
  ["The same invoice twice", "One invoice is one payment on-chain; the agent flags repeated amounts and dates."],
  ["Hidden instructions to the AI inside an invoice", "Claim text is data. The model can only be stricter, and the rules flag “urgent”, “new wallet” and “ignore rules”."],
  ["Books rounding away a difference", "A payment is recorded only if it matches to 6 decimals; otherwise it waits for a person."],
  ["Not enough cash for every claim", "The oldest work is paid first; the rest waits, with the exact amount short."],
];

const FAQ: [string, React.ReactNode][] = [
  ["Does SendSure hold our money?", <>No. The money stays in your own wallet. You sign a budget that lets your team&apos;s contract move up to that amount, only through its rules. You can set it to 0 at any time.</>],
  ["What if the AI makes a mistake?", <>Claude can only make a decision stricter: hold a payment or ask a person. It can never pay something the contract would refuse, change an amount or add a payee. The worst AI mistake is a delay.</>],
  ["What if a payee loses their wallet?", <>They prove a new address. A change needs the old key and the new key plus a waiting period; if the old key is lost, the payer revokes the payee and sends a new invite. A passkey wallet lives in the phone&apos;s passkey store (iCloud Keychain or Google Password Manager), so it moves with them to a new phone.</>],
  ["Do payees need to understand crypto?", <>No. They open a link and sign once, or create a passkey wallet with Face ID. Gas is paid for them.</>],
  ["Why testnet?", <>The contracts are not audited yet. Teams rehearse real payouts with their real contractors on Arc testnet first. Mainnet comes after an audit, with design partners.</>],
  ["What does it cost?", <>It is free on testnet, and the payout check is always free. Other agents pay per call for checks: $0.001 to verify a payee, $0.005 for a payout file.</>],
  ["Which chains and currencies?", <>Payouts are USDC on Arc, and payout addresses are EVM addresses. The free check also reads Solana, Tron, Stellar, Cosmos, bitcoin (bc1) and Polkadot addresses.</>],
  ["Is it open source?", <>Yes: MIT for the core; the Odoo add-on is LGPL-3 and the ERPNext app GPL-3, as those ecosystems require. Every live test run is recorded in the repo.</>],
  ["What does the dashboard count?", <>Only on-chain events from orgs SendSure created, split into outside teams, our own team and our tests. Only outside teams count as usage.</>],
  ["What do you store about me?", <>As little as possible, and it is listed on <a href="/data">What we store</a>. Payee names stay in the payer&apos;s browser; the chain only sees addresses and hashes.</>],
];

const GLOSSARY: [string, string][] = [
  ["USDC", "A digital dollar issued by Circle. 1 USDC is meant to equal 1 US dollar."],
  ["Arc", "Circle's blockchain, where USDC also pays the transaction fees."],
  ["Testnet", "A practice version of the chain, with test money that has no value."],
  ["Wallet, address", "An app that holds digital money; the address is its account number (it starts with 0x)."],
  ["Address poisoning", "A trick that plants a look-alike address in your history so you copy the wrong one."],
  ["Signature", "A proof, made with a wallet, that its owner agreed to something. Free; it moves no money."],
  ["Passkey", "A login stored on your phone and unlocked by Face ID, a fingerprint or a PIN. Nothing to write down."],
  ["Smart contract", "A program on the blockchain that follows its rules exactly. Here: who can be paid, how much, and when."],
  ["Mandate", "Your team's own contract with your rules: budget, caps, approvers and agents."],
  ["Claim", "An invoice the payee signed: invoice number, amount and work period."],
  ["Co-sign", "A person approving one exact claim on-chain before it can be paid."],
  ["Budget (permit)", "A signed limit on how much your team's contract may move from your wallet."],
  ["Gas", "The small fee to put a transaction on the chain. SendSure or Circle pays it for signers."],
  ["Agent", "Software that runs the payables: checks claims, asks Claude, pays inside the rules."],
  ["Anchor", "A fingerprint (hash) of the decision log written on-chain, so nobody can change the log unnoticed."],
  ["x402", "A way for one program to pay another per request, in USDC."],
  ["MCP", "A standard way to plug a tool into an AI assistant such as Claude."],
];

export default function DocsPage() {
  return (
    <div className="docs">
      <aside className="toc" aria-label="On this page">
        <p className="eyebrow">On this page</p>
        <nav>
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="doc">
        <p className="eyebrow">Docs</p>
        <h1>How SendSure works</h1>
        <p className="lede">
          SendSure is a payables agent for teams that pay contractors and vendors in USDC. It pays only a person who proved
          their own address, only for an invoice they signed, and only inside a budget a contract on Arc enforces. Then it
          writes every payment into the books the team already keeps. This page explains all of it in plain words.
        </p>
        <div className="toc-chips">
          {TOC.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </div>

        <section id="short">
          <h2>The short version</h2>
          <div className="cards">
            <div className="card">
              <span className="tag stop">The problem</span>
              <h3>Money is lost at the address</h3>
              <p>A look-alike address, a &quot;we changed our wallet&quot; email, a forged invoice. The books still balance, so nobody notices until the contractor asks.</p>
            </div>
            <div className="card">
              <span className="tag">The fix</span>
              <h3>The payee proves it, a contract enforces it</h3>
              <p>Each payee proves their address by signing with it and signs each invoice. A contract on Arc pays only that address, only for that invoice, only inside the budget.</p>
            </div>
            <div className="card">
              <span className="tag">The agent</span>
              <h3>It can say no; only the contract says yes</h3>
              <p>An agent runs the payables every day and asks Claude about anything unusual. It can hold a payment but never make one the contract would refuse.</p>
            </div>
          </div>
        </section>

        <section id="problem">
          <h2>The problem: stablecoin payouts are lost at the address</h2>
          <p className="sub">
            A bank transfer can often be recalled. A USDC payment to the wrong address cannot. And the books still show a
            correct, balanced payment, so the mistake is found weeks later.
          </p>
          <div className="cards">
            <div className="card">
              <span className="tag stop">Address poisoning</span>
              <h3>A look-alike from history</h3>
              <p>An attacker sends a tiny transfer from an address with the same first and last characters as your contractor&apos;s. Next payday someone copies the wrong one.</p>
            </div>
            <div className="card">
              <span className="tag stop">Email fraud</span>
              <h3>&quot;We changed our wallet&quot;</h3>
              <p>A fake or hacked email asks you to pay a new address from now on. One payment goes to the thief, and it looks normal in every system.</p>
            </div>
            <div className="card">
              <span className="tag stop">Invoice fraud</span>
              <h3>Forged or repeated invoices</h3>
              <p>A bill nobody really sent, or the same work billed twice under a new number. A spreadsheet and a wallet will pay both.</p>
            </div>
          </div>
          <div className="notice warn" style={{ marginTop: 18 }}>
            <p>
              <b>Why now:</b> since 2025, banks in the EU must check the name on an account before a transfer (Verification of
              Payee). Stablecoin payouts have had nothing like it. SendSure adds it, and a contract enforces it.
            </p>
          </div>
        </section>

        <section id="rules">
          <h2>The three rules</h2>
          <p className="sub">Every SendSure payment passes three rules. They live in a smart contract on Arc, so no server, no person and no AI can skip them.</p>
          <div className="cards numbered">
            <div className="card">
              <h3>The payee proved their address</h3>
              <p>They signed with that wallet, once. Changing it later needs the old wallet, the new wallet and a waiting period the payer can cancel. A payee without a wallet app can use a passkey.</p>
            </div>
            <div className="card">
              <h3>The payee signed this claim</h3>
              <p>Each invoice becomes a claim the payee signs: one invoice number, one amount, one work period. A forged invoice cannot carry their signature, and one invoice is paid only once.</p>
            </div>
            <div className="card">
              <h3>A contract enforces the budget</h3>
              <p>The team signs a spending limit. The contract also keeps caps per payee and per claim, and makes a person co-sign the first payment to any new address and any large amount.</p>
            </div>
          </div>
          <div className="split" style={{ marginTop: 24 }}>
            <div className="ticket">
              <div className="head">
                <div>
                  <div className="amount">0.30 USDC</div>
                  <span className="hint mono">to 0x53CC78…591a · Arc testnet</span>
                </div>
                <span className="chip PAY">Paid on Arc</span>
              </div>
              <ul>
                <li><span className="ok">✓</span><span>The payee proved this address<small>signed with it, once</small></span></li>
                <li><span className="ok">✓</span><span>The payee signed this claim<small>one invoice, one amount, paid once</small></span></li>
                <li><span className="ok">✓</span><span>Inside the budget<small>checked by the contract, not by the AI</small></span></li>
                <li><span className="ok">✓</span><span>The decision is anchored on Arc<small>the payment carries its hash; anyone can replay it</small></span></li>
              </ul>
              <div className="foot">
                <a href="/receipt?tx=0xcfbb0de697f5a1349997b798de2443e358844ad39b47eb26a36553bd3128e89e">Open this receipt</a>
                <span>a test payment from our own runs</span>
              </div>
            </div>
            <div>
              <h3 style={{ marginTop: 0 }}>Every payment has a public receipt</h3>
              <p>
                It shows the payee&apos;s proof of address, their signed claim, the agent&apos;s decision and the transaction. A
                contractor can forward it, and an auditor can check it without an account.
              </p>
              <p className="hint">Each step on a receipt links to the transaction on the Arc explorer.</p>
            </div>
          </div>
        </section>

        <section id="flow">
          <h2>How a payment moves</h2>
          <p className="sub">Who does what, what they sign, and who pays the gas. The money stays in the payer&apos;s wallet until a payment is due.</p>
          <ol className="flow">
            {FLOW.map((s) => (
              <li key={s.title}>
                <span className="who">{s.who}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="parts">
          <h2>Every part, and why it matters</h2>
          <div className="table-wrap stack">
            <table>
              <thead>
                <tr>
                  <th>Part</th>
                  <th>What it does</th>
                  <th>Why it matters</th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map(([part, what, why]) => (
                  <tr key={part}>
                    <td><b>{part}</b></td>
                    <td data-label="What it does">{what}</td>
                    <td data-label="Why it matters">{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="safety">
          <h2>Who can move money</h2>
          <p className="sub">The AI can say no. Only the contract can say yes. Every actor has a narrow job, enforced on-chain.</p>
          <div className="table-wrap stack">
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Can</th>
                  <th>Cannot</th>
                </tr>
              </thead>
              <tbody>
                {ROLES.map(([who, can, cannot]) => (
                  <tr key={who}>
                    <td><b>{who}</b></td>
                    <td data-label="Can">{can}</td>
                    <td data-label="Cannot">{cannot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="privacy" style={{ marginTop: 18 }}>
            <b>Worst case:</b> if someone stole the agent&apos;s key, they could only pay proven addresses, for claims the payees
            signed, inside the budget the payer granted, with first payments still waiting for a person. SendSure never holds
            anyone&apos;s money.
          </div>
        </section>

        <section id="attacks">
          <h2>Attacks, and what stops them</h2>
          <div className="table-wrap stack">
            <table className="two">
              <thead>
                <tr>
                  <th>Attack</th>
                  <th>What stops it</th>
                </tr>
              </thead>
              <tbody>
                {ATTACKS.map(([attack, stop]) => (
                  <tr key={attack}>
                    <td><b>{attack}</b></td>
                    <td data-label="What stops it">{stop}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="use">
          <h2>How to use it</h2>
          <p className="sub">Everything runs on Arc testnet with test USDC, so nobody risks real money. Pick your role.</p>
          <div className="roles">
            <a href="#payer">Teams who pay</a>
            <a href="#payee">Payees</a>
            <a href="#erp">Odoo and ERPNext</a>
            <a href="#check">Free payout check</a>
            <a href="#developers">Developers and agents</a>
            <a href="#first-look">A first look</a>
          </div>

          <div className="guide" id="payer">
            <h3>Teams who pay <a className="where" href="/org">/org</a></h3>
            <p>For an agency, startup, DAO or grant program that pays people in USDC.</p>
            <ol>
              <li>Open <a href="/org">/org</a> and connect the wallet that holds the team&apos;s USDC. The page adds Arc testnet for you.</li>
              <li>No test USDC? Click <b>Get 2 test USDC from SendSure</b>.</li>
              <li>Name the team, check the rules (by default 100 USDC per 30 days, 50 per payee, 50 per claim, co-sign above 25) and click <b>Sign and create my org</b>.</li>
              <li><b>Sign budget</b>: choose how much the org may spend from your wallet.</li>
              <li>Type the names of the people you pay and click <b>Sign and create invite links</b>. Send each link from your own email or chat.</li>
              <li>When a claim arrives, click <b>Run the agent now</b>, or turn on autopilot.</li>
              <li>For a first payment, click <b>Co-sign this claim</b>. The agent then pays it.</li>
              <li>Download your books, connect Odoo or ERPNext with a books key, and turn on Discord or Slack notices.</li>
            </ol>
            <p className="hint">Prefer help? Click <b>Get set up</b> on /org for a free 20-minute setup call, with one rehearsal payout.</p>
          </div>

          <div className="guide" id="payee">
            <h3>Payees <a className="where" href="/verify">/verify</a></h3>
            <p>For freelancers and vendors. About a minute, free, and it works on a phone.</p>
            <ol>
              <li>Open the invite link your client sent you.</li>
              <li>Choose how to be paid: <b>Connect wallet</b>, or <b>Create a passkey wallet</b> if you have no wallet app. A passkey uses Face ID, a fingerprint or your phone&apos;s PIN.</li>
              <li>Click <b>Sign and confirm</b>. Your address is now proven, and the gas is paid for you.</li>
              <li>For each invoice, enter the invoice number, amount and work period, then <b>Sign and send claim</b>. If your client already sent the invoice, check it and sign.</li>
              <li>You are paid when the agent runs. With a passkey wallet, the page shows your balance and lets you <b>Send USDC</b> to another wallet or an exchange.</li>
            </ol>
            <p className="hint">After this, nobody can redirect your payments with an email. Changing your address needs your old wallet too.</p>
          </div>

          <div className="guide" id="erp">
            <h3>Odoo and ERPNext <a className="where" href="/books">/books</a></h3>
            <p>For teams whose bills live in their ERP.</p>
            <ol>
              <li>Install the <a href={`${REPO}/tree/main/integrations/odoo`}>Odoo 19 add-on</a> or the <a href={`${REPO}/tree/main/integrations/erpnext`}>ERPNext 15 app</a>. A Docker setup is included: <code>./run.sh up</code>.</li>
              <li>On <a href="/org">/org</a>, click <b>Create a books key</b>. In Odoo, open Invoicing → Settings → SendSure, paste the key and click <b>Test connection</b>. It creates USDC and a &quot;USDC on Arc&quot; journal.</li>
              <li>On a vendor, paste their SendSure invite link and click <b>Email the invite</b>; Odoo writes the email for you.</li>
              <li>Once the vendor has proved their address, click <b>Check with SendSure</b>, then a manager trusts that wallet. No other wallet can be trusted, not even by the admin.</li>
              <li>On a posted bill, click <b>Pay with SendSure</b>. The vendor signs it, the agent pays it, and Odoo records it through Register Payment with the Arc transaction in the memo.</li>
              <li>Bills waiting for a person show <b>Co-sign in SendSure</b>. Filters show bills in progress, needing a person, or paid on Arc. Cancelling a bill withdraws it.</li>
            </ol>
          </div>

          <div className="guide" id="check">
            <h3>Free payout check <a className="where" href="/check">/check</a></h3>
            <p>No account and no wallet. A good first step for any team.</p>
            <ol>
              <li>Open <a href="/check">/check</a>. Paste or upload this run&apos;s payout CSV, and last run&apos;s.</li>
              <li>Read the result: <span className="chip STOP">Stop</span> for a look-alike or invalid address, <span className="chip REVIEW">Review</span> for a changed wallet, new payee, duplicate or amount jump, <span className="chip PAY">Pay</span> when it matches last time.</li>
              <li>Optional: click <b>Review with Claude</b> for a line-by-line review, and mark where you agree.</li>
              <li><b>Download checked list</b> to keep a copy.</li>
            </ol>
          </div>

          <div className="guide" id="developers">
            <h3>Developers and AI agents <a className="where" href="/api/x402">/api/x402</a></h3>
            <ol>
              <li>Add SendSure to Claude or any MCP client:</li>
            </ol>
            <div className="mono-box" style={{ margin: "10px 0 12px" }}>claude mcp add --transport http sendsure {SITE}/api/mcp</div>
            <ol start={2}>
              <li>Or pay per call over Circle Gateway (x402): verify a payee for $0.001 or check a payout file for $0.005, in USDC. The catalog is at <a href="/api/x402">/api/x402</a>.</li>
              <li>Everything is <a href={REPO}>open source</a>: contracts, web app, agent, Odoo and ERPNext apps, and every live test run.</li>
            </ol>
          </div>

          <div className="guide" id="first-look">
            <h3>A first look in two minutes <a className="where" href="/try">/try</a></h3>
            <ol>
              <li>Open <a href="/try">/try</a>. No wallet needed.</li>
              <li>Watch a payee prove their address, an attacker&apos;s claim get refused on-chain, a fake address change fail, a real payment get co-signed and paid, and Claude hold tricky claims with reasons.</li>
              <li>Then open the receipt, the <a href="/books">books</a> and the <a href="/dashboard">dashboard</a>.</li>
            </ol>
          </div>
        </section>

        <section id="why">
          <h2>Why use it</h2>
          <div className="cards">
            <div className="card">
              <h3>The team that pays</h3>
              <p>No wrong-wallet losses. Payables run inside limits you set, a person approves only what needs a person, and the money stays in your wallet until it is due.</p>
            </div>
            <div className="card">
              <h3>The payee</h3>
              <p>Paid to the address you chose, every time. Nobody can redirect your pay with a fake email. Free, about a minute, and no wallet app needed.</p>
            </div>
            <div className="card">
              <h3>The accountant</h3>
              <p>Every payment arrives with its invoice, its transaction and its receipt, recorded once and never rounded, in Odoo, ERPNext or any ledger.</p>
            </div>
            <div className="card">
              <h3>The security lead</h3>
              <p>Rules on-chain instead of in a server, every decision replayable, and a stolen key capped by the budget and by proven addresses.</p>
            </div>
          </div>
          <div className="table-wrap stack" style={{ marginTop: 24 }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Spreadsheet and wallet</th>
                  <th>Multisig</th>
                  <th>SendSure</th>
                </tr>
              </thead>
              <tbody>
                <tr><td><b>Who decides the payout address</b></td><td data-label="Spreadsheet and wallet">Whoever edits the sheet</td><td data-label="Multisig">The payer&apos;s list</td><td data-label="SendSure" className="yes">The payee, by signing</td></tr>
                <tr><td><b>Stops a look-alike address</b></td><td data-label="Spreadsheet and wallet" className="no">No</td><td data-label="Multisig">Only if a signer notices</td><td data-label="SendSure" className="yes">Yes, on-chain</td></tr>
                <tr><td><b>Stops a &quot;new wallet&quot; email</b></td><td data-label="Spreadsheet and wallet" className="no">No</td><td data-label="Multisig">Only if a signer notices</td><td data-label="SendSure" className="yes">Old key, new key and a wait</td></tr>
                <tr><td><b>Each invoice paid only once</b></td><td data-label="Spreadsheet and wallet" className="no">No</td><td data-label="Multisig" className="no">No</td><td data-label="SendSure" className="yes">Yes, on-chain</td></tr>
                <tr><td><b>Runs by itself, with reasons</b></td><td data-label="Spreadsheet and wallet" className="no">No</td><td data-label="Multisig" className="no">No</td><td data-label="SendSure" className="yes">Agent and autopilot</td></tr>
                <tr><td><b>Books exact to the cent</b></td><td data-label="Spreadsheet and wallet">By hand</td><td data-label="Multisig">By hand</td><td data-label="SendSure" className="yes">Odoo, ERPNext, ledgers</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="circle">
          <h2>Built on Circle and Arc</h2>
          <div className="cards">
            <div className="card">
              <span className="tag">Arc</span>
              <h3>Contracts, with USDC as gas</h3>
              <p>PayeeRegistry and Mandate run on Arc testnet, source-verified. USDC is the money, the gas and the budget (EIP-2612 permits), so nobody needs a second token.</p>
            </div>
            <div className="card">
              <span className="tag">Modular Wallets and Gas Station</span>
              <h3>Passkey wallets for payees</h3>
              <p>Payees without a wallet app get a smart account protected by a passkey. Gas Station sponsors their transactions.</p>
            </div>
            <div className="card">
              <span className="tag">Gateway and x402</span>
              <h3>Paid checks for agents</h3>
              <p>Other agents pay $0.001 or $0.005 in USDC per check, settled through Circle Gateway.</p>
            </div>
            <div className="card">
              <span className="tag">Agent wallet</span>
              <h3>An agent that can pay</h3>
              <p>A Circle agent wallet signs in with ERC-1271 and can send <code>settle()</code> and <code>anchor()</code> itself.</p>
            </div>
          </div>
        </section>

        <section id="proof">
          <h2>Proof: tested on the live site</h2>
          <p className="sub">
            Each live test suite runs real transactions on Arc testnet against this site and records every check it made, in
            the <a href={`${REPO}/tree/main/deployments`}>repo</a>.
          </p>
          <div className="stats five">
            <div className="stat"><b>16</b><span>live test suites</span></div>
            <div className="stat"><b>47</b><span>contract tests</span></div>
            <div className="stat"><b>94</b><span>TypeScript tests</span></div>
            <div className="stat"><b>30</b><span>tests inside Odoo</span></div>
            <div className="stat"><b>25</b><span>tests inside ERPNext</span></div>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>Arc testnet only. The contracts are not audited yet.</p>
        </section>

        <section id="faq">
          <h2>Questions people ask</h2>
          <div className="faq">
            {FAQ.map(([q, a], i) => (
              <details key={q} open={i === 0}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="glossary">
          <h2>Glossary</h2>
          <div className="card">
            <dl className="facts">
              {GLOSSARY.map(([term, meaning]) => (
                <div key={term} style={{ display: "contents" }}>
                  <dt><b>{term}</b></dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="links">
          <h2>Contracts and links</h2>
          <div className="card">
            <dl className="facts">
              <dt>PayeeRegistry</dt>
              <dd><a className="mono" href="https://explorer.testnet.arc.io/address/0x53f0761fC833064Ca78fc09f6E37aa20eCb21378">0x53f0761fC833064Ca78fc09f6E37aa20eCb21378</a></dd>
              <dt>MandateFactory</dt>
              <dd><a className="mono" href="https://explorer.testnet.arc.io/address/0x8c474aCDDe8bD150B65234582171Fd3f70A49FC2">0x8c474aCDDe8bD150B65234582171Fd3f70A49FC2</a></dd>
              <dt>Network</dt>
              <dd>Arc testnet (chain 5042002)</dd>
              <dt>Source code</dt>
              <dd><a href={REPO}>github.com/0x-pankaj/sendsure</a></dd>
              <dt>System status</dt>
              <dd><a href="/status">/status</a></dd>
            </dl>
          </div>
        </section>

        <div className="cta-band">
          <h2>See it work in two minutes</h2>
          <p>No wallet needed for the demo. When you are ready, set up your team on Arc testnet in about five minutes.</p>
          <div className="row">
            <a className="btn lg" href="/try">Try the demo</a>
            <a className="btn lg secondary" href="/org">Set up your team</a>
          </div>
        </div>
      </article>
    </div>
  );
}
