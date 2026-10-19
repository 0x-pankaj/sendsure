import { CONTACT_URL } from "../lib/contact";

/** Where Kraken and Gate announced USDC deposits and withdrawals on Arc (both on Sept 16, 2026). */
const KRAKEN_ARC = "https://blog.kraken.com/product/new-features/usdc-on-arc-deposits-and-withdrawals-now-available";
const GATE_ARC = "https://www.gate.com/announcements/article/101771";

/**
 * The mainnet beta's answers for a supplier who has never held USDC: what it is, how it gets to a bank, what it
 * costs and how to keep it safe. SendSure has no deal with any exchange; the ones named announced USDC on Arc.
 */
export function GettingPaid({ payer }: { payer: string }) {
  return (
    <section style={{ marginTop: 28, maxWidth: 780 }}>
      <h2 style={{ fontSize: "1.2rem" }}>Getting paid in USDC</h2>
      <div className="faq">
        <details>
          <summary>What is USDC?</summary>
          <p>
            A digital US dollar issued by Circle. It is built to stay at 1 US dollar, unlike bitcoin, and Circle publishes
            monthly reports on the reserves behind it.
          </p>
        </details>
        <details open>
          <summary>How do I get it into my bank?</summary>
          <ol>
            <li>
              Choose an exchange that accepts USDC on Arc and pays out to a bank in your country. <a href={KRAKEN_ARC}>Kraken</a>{" "}
              and <a href={GATE_ARC}>Gate</a>, for example, have accepted USDC on Arc since September 16, 2026.
            </li>
            <li>
              In the exchange, open Deposit, pick USDC, choose the network <b>Arc</b> and copy the address it shows. USDC sent on
              another network can be lost.
            </li>
            <li>
              In your wallet, send the USDC to that address. Keep a few cents back for the fee, which Arc takes in USDC. Try a
              small amount first.
            </li>
            <li>In the exchange, sell the USDC for your currency and withdraw it to your bank.</li>
          </ol>
          <p>
            SendSure has no deal with any exchange and earns nothing from them. Stuck? <a href={CONTACT_URL}>Ask us</a>: a person
            answers.
          </p>
        </details>
        <details>
          <summary>What does it cost me?</summary>
          <p>
            Nothing to confirm your address or to sign an invoice: SendSure pays those network fees. Sending USDC out of your
            wallet later costs a fraction of a cent, paid in USDC. An exchange may charge for selling it or for the bank
            transfer, and shows its fee before you confirm.
          </p>
        </details>
        <details>
          <summary>How do I keep it safe?</summary>
          <p>
            Only your wallet can move the USDC in it. Write your wallet&apos;s recovery phrase on paper and keep it offline: it is
            the only way back in, and nobody from SendSure or {payer} will ever ask for it. Nobody can redirect your payments
            either: a new payout address needs your current wallet, the new one, and a waiting period.
          </p>
        </details>
      </div>
    </section>
  );
}
