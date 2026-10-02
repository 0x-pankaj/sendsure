import type { Metadata } from "next";
import { CONTACT_URL } from "../../lib/contact";

export const metadata: Metadata = { title: "What SendSure stores" };

export default function DataPage() {
  return (
    <>
      <h1>What SendSure stores, and where</h1>
      <p className="lede">
        SendSure runs on Arc <b>testnet</b>: the USDC is test money with no value. It is open source, so everything below can be
        checked in <a href="https://github.com/0x-pankaj/sendsure/tree/main/apps/web/migrations">the database schema</a>.
      </p>

      <h2>On Arc (public, permanent)</h2>
      <ul>
        <li>Your org: its contract, owner, approvers, budget limits and treasury address.</li>
        <li>
          Each payee&apos;s payout address, bound to a random invite id. <b>No names, emails or invoice numbers go on-chain</b>:
          invoices appear only as a salted hash.
        </li>
        <li>Each payment, refusal, escalation and co-sign, with the hash of the agent&apos;s decision.</li>
      </ul>

      <h2>In your browser only</h2>
      <ul>
        <li>Payee names and emails you type in <a href="/org">/org</a>. They never reach our server.</li>
        <li>
          Payout files you check in <a href="/check">/check</a>: the check runs entirely in your browser; the file is never
          uploaded (only an anonymous count that a check ran).
        </li>
      </ul>

      <h2>On our server (Cloudflare D1)</h2>
      <ul>
        <li>Claims payees signed: payout address, amount, invoice number, work period, the description they wrote, signature.</li>
        <li>
          Invoices you ask SendSure to read: the fields read from them, each with the words it came from (these can include the
          issuer&apos;s name). The invoice text or photo itself is not kept.
        </li>
        <li>Bills your Odoo sends: bill number, amount, date and line descriptions.</li>
        <li>The agent&apos;s decision log (what it checked and why), which anyone with the org can replay.</li>
        <li>A secret salt per org (so invoice numbers stay private on-chain), and integration keys as hashes only.</li>
        <li>No accounts or passwords: you sign in by signing a message with your wallet.</li>
        <li>
          If you fill in &ldquo;Get set up&rdquo;: what you typed there (team, how to reach you, how you pay, your next payout),
          to contact you about setting it up. Nothing else.
        </li>
        <li>If your org turns on notifications: the Discord or Slack webhook URL you gave, to post your notices there.</li>
        <li>
          Anonymous counts: that a payout check ran, an invite link was opened, a walkthrough started or a ledger was
          downloaded, per day. No addresses, amounts, files or anything that identifies you.
        </li>
      </ul>

      <h2>Sent to an AI model</h2>
      <p>
        Invoices you ask SendSure to read, and the claims the agent reviews (invoice number, amount, period, description, the
        contract&apos;s check), go to Claude by Anthropic through MeshAPI. The model can only hold or escalate a payment; it
        can never make one happen.
      </p>

      <h2>Removing your data</h2>
      <p>
        Anything on our server can be deleted on request: <a href={CONTACT_URL}>ask us</a>. What is on Arc cannot be removed by
        anyone, which is why it holds no names.
      </p>
    </>
  );
}
