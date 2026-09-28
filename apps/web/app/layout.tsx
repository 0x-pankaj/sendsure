import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SendSure",
  description: "Pay only the right person. A payables agent for teams that pay contractors in stablecoins, on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="wrap">
            <a className="brand" href="/">SendSure</a>
            <nav aria-label="Main">
              <a href="/check">Check a payout</a>
              <a href="/org">For payers</a>
              <a href="https://github.com/0x-pankaj/sendsure">GitHub</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">Arc testnet · open source (MIT) · built during the Tameion Agents Hackathon</div>
        </footer>
      </body>
    </html>
  );
}
