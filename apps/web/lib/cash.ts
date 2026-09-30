// The agent's cash plan for one run. Pure: no chain, no database.
//
// The contract's check() looks at each claim alone. Several claims can each pass and still not fit
// together in what the treasury can pay right now. The agent decides the order before it sends anything:
// oldest work first, and whatever does not fit waits with a plain reason instead of failing on-chain.

export interface CashSnapshot {
  /** The treasury's USDC balance at the run's block (base units, as a string). */
  balance: string;
  /** What the treasury lets the org's contract spend (its USDC allowance). */
  allowance: string;
  /** The smaller of the two: what can actually be paid right now. */
  available: string;
  /** Claims the agent decided to pay this run, in total. */
  payable: string;
  /** Claims waiting for a person's co-sign, in total. */
  waitingCosign: string;
  /** How much is missing to pay everything payable. "0" when it all fits. */
  shortBy: string;
}

export interface CashItem {
  claimId: string;
  amount: bigint;
  /** End of the work period (unix seconds): the oldest work is paid first. */
  periodEnd: number;
  createdAt: number;
}

/**
 * Which payable claims fit in `available`, oldest work first. A claim that does not fit is skipped and a
 * smaller, later one may still be paid. Returns the ids that wait.
 */
export function planCash(payable: CashItem[], available: bigint): { funded: string[]; deferred: string[]; shortBy: bigint } {
  const order = [...payable].sort((a, b) => a.periodEnd - b.periodEnd || a.createdAt - b.createdAt || a.claimId.localeCompare(b.claimId));
  let left = available;
  const funded: string[] = [];
  const deferred: string[] = [];
  for (const c of order) {
    if (c.amount <= left) {
      funded.push(c.claimId);
      left -= c.amount;
    } else deferred.push(c.claimId);
  }
  const total = payable.reduce((sum, c) => sum + c.amount, 0n);
  return { funded, deferred, shortBy: total > available ? total - available : 0n };
}
