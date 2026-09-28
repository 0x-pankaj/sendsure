import type { LedgerInput } from "../src/index";

/** A two-day sample ledger: two payments, two closing balances read from the chain. */
export const SAMPLE: LedgerInput = {
  title: "Acme Labs (sample)",
  org: "0x1526Fb7f525B9eBCD2e5760299962d0119d07DF3",
  treasury: "0x0000000000000000000000000000000000000abc",
  payments: [
    {
      date: "2026-09-28",
      payee: "María López",
      invoice: "INV-A",
      amount: 300_000n,
      txHash: "0xaaa",
      claimId: "0xc1",
      decisionHash: "0xd1",
      payout: "0x1111111111111111111111111111111111111111",
    },
    {
      date: "2026-09-29",
      payee: "North Star Design",
      invoice: "INV-7",
      amount: 12_500_001n,
      txHash: "0xbbb",
      claimId: "0xc2",
      decisionHash: "0xd2",
      payout: "0x2222222222222222222222222222222222222222",
    },
  ],
  balances: [
    { day: "2026-09-28", amount: 400_000n, block: "100" },
    { day: "2026-09-29", amount: 87_899_999n, block: "200" },
  ],
};
