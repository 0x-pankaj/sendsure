import { Plus_Jakarta_Sans } from "next/font/google";
import { CONTACT_URL } from "../lib/contact";
import type { Metadata } from "next";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-jakarta" });
const REPO = "https://github.com/0x-pankaj/sendsure";

export const metadata: Metadata = {
  title: "SendSure: pay only the right person",
  description: "Pay only the right person. A payables agent for teams that pay contractors in stablecoins, on Arc.",
};

/** The SendSure mark: a proven payout, a check inside a rounded square. */
function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ss-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0d7a57" />
          <stop offset="0.6" stopColor="#1fae7b" />
          <stop offset="1" stopColor="#6d5bd0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ss-g)" />
      <path d="M9.5 16.5l4.2 4.2 8.8-9.4" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body style={{ fontFamily: "var(--font-jakarta), var(--font-sans)" }}>
        <header className="site">
          <div className="wrap">
            <a className="brand" href="/">
              <Mark />
              SendSure
            </a>
            <nav aria-label="Main">
              <a href="/check">Check a payout</a>
              <a href="/org">For payers</a>
              <a href="/try">Try it</a>
              <a href="/books">Books</a>
              <a href="/docs">Docs</a>
              <a href="/dashboard">Dashboard</a>
            </nav>
            <div className="actions">
              <a className="btn secondary" href="/try">
                Try the demo
              </a>
              <a className="btn" href="/org">
                Set up your team
              </a>
            </div>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">
            <div className="cols">
              <div className="about">
                <a className="brand" href="/" style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 800, color: "var(--ink)", fontSize: "1.1rem" }}>
                  <Mark />
                  SendSure
                </a>
                <p>Pay only the right person. A payables agent for teams that pay contractors and vendors in USDC, on Arc.</p>
              </div>
              <div>
                <h4>Product</h4>
                <ul>
                  <li><a href="/check">Check a payout</a></li>
                  <li><a href="/try">Try it, no wallet</a></li>
                  <li><a href="/org">Set up your team</a></li>
                  <li><a href="/verify">For payees</a></li>
                  <li><a href="/docs">How it works</a></li>
                </ul>
              </div>
              <div>
                <h4>Books</h4>
                <ul>
                  <li><a href="/books">Odoo 19</a></li>
                  <li><a href="/books">ERPNext 15</a></li>
                  <li><a href="/books">beancount and hledger</a></li>
                  <li><a href="/books">CSV journals</a></li>
                </ul>
              </div>
              <div>
                <h4>Developers</h4>
                <ul>
                  <li><a href={REPO}>GitHub (MIT)</a></li>
                  <li><a href="/api/x402">Paid checks (x402)</a></li>
                  <li><a href={`${REPO}#try-it`}>MCP server</a></li>
                  <li><a href="/status">System status</a></li>
                </ul>
              </div>
              <div>
                <h4>Trust</h4>
                <ul>
                  <li><a href="/dashboard">Live numbers</a></li>
                  <li><a href="/data">What we store</a></li>
                  <li><a href={CONTACT_URL}>Contact</a></li>
                </ul>
              </div>
            </div>
            <div className="legal">
              <span>Arc testnet only · not audited · open source (MIT; Odoo add-on LGPL-3, ERPNext app GPL-3)</span>
              <span>Built during the Tameion Agents Hackathon</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
