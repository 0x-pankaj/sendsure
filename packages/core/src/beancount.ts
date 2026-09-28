// Beancount export of a SendSure org's payments. Pure (runs in the browser, where payee names live).
//
// Every SendSure payment is one transaction carrying its claim, its decision hash and its Arc
// transaction. After each payment day the treasury balance is asserted from the chain. Anything that
// moved the treasury outside SendSure that day (deposits, gas, other transfers) is one explicit entry,
// computed from the chain balance, so the books reconcile to the chain and nothing is hidden.

const DECIMALS = 6n;
const UNIT = 10n ** DECIMALS;

export interface LedgerPayment {
  /** UTC date of the payment block, YYYY-MM-DD. */
  date: string;
  payee: string;
  invoice: string;
  /** USDC base units (6 decimals). */
  amount: bigint;
  txHash: string;
  claimId: string;
  decisionHash: string;
  payout: string;
}

export interface LedgerBalance {
  /** The day whose closing balance this is (UTC). The assertion is dated the next day. */
  day: string;
  /** The treasury's USDC balance at the last block of that day (or now, for today). */
  amount: bigint;
  block: string;
}

export interface LedgerInput {
  title: string;
  org: string;
  treasury: string;
  payments: LedgerPayment[];
  balances: LedgerBalance[];
}

/** 40000000n -> "40.000000"; always six decimals, so no rounding ever happens in the books. */
export function usdcAmount(units: bigint): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  return `${neg ? "-" : ""}${abs / UNIT}.${(abs % UNIT).toString().padStart(Number(DECIMALS), "0")}`;
}

/** "Maria López & Co." -> "Expenses:Contractors:Maria-Lopez-Co"; beancount needs A-Z/0-9 starts. */
export function payeeAccount(name: string, fallback: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const part = /^[A-Za-z0-9]/.test(cleaned) ? cleaned[0]!.toUpperCase() + cleaned.slice(1) : `Payee-${fallback}`;
  return `Expenses:Contractors:${part}`;
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function toBeancount(input: LedgerInput): string {
  const payments = [...input.payments].sort((a, b) => a.date.localeCompare(b.date) || a.txHash.localeCompare(b.txHash));
  const days = [...new Set(payments.map((p) => p.date))].sort();
  const balanceOf = new Map(input.balances.map((b) => [b.day, b]));
  const openDate = days[0] ?? new Date().toISOString().slice(0, 10);
  const treasury = "Assets:Arc:Treasury";
  const other = "Equity:Treasury-Other-Flows";
  const accounts = new Map<string, string>();
  for (const p of payments) accounts.set(payeeAccount(p.payee, p.payout.slice(2, 8)), p.payee);

  const out: string[] = [
    `; SendSure books: ${input.title}`,
    `; Org ${input.org} on Arc testnet. Treasury ${input.treasury}.`,
    "; Each payment carries its claim id, the agent's decision hash and its Arc transaction.",
    "; Balances come from the chain; movements outside SendSure are computed from them, never guessed.",
    `option "title" ${quote(input.title)}`,
    'option "operating_currency" "USDC"',
    'option "inferred_tolerance_default" "USDC:0.000001"',
    "",
    `${openDate} commodity USDC`,
    '  name: "USDC on Arc testnet (6 decimals)"',
    "",
    `${openDate} open ${treasury} USDC`,
    `${openDate} open ${other} USDC`,
    ...[...accounts.keys()].sort().map((a) => `${openDate} open ${a} USDC`),
    "",
  ];

  let running = 0n;
  for (const day of days) {
    const today = payments.filter((p) => p.date === day);
    const paid = today.reduce((sum, p) => sum + p.amount, 0n);
    const closing = balanceOf.get(day);
    if (closing) {
      const outside = closing.amount - (running - paid);
      if (outside !== 0n) {
        out.push(
          `${day} * "Treasury" "Movements outside SendSure (deposits, gas, other transfers), from the chain balance"`,
          `  ${treasury}  ${usdcAmount(outside)} USDC`,
          `  ${other}`,
          "",
        );
        running += outside;
      }
    }
    for (const p of today) {
      out.push(
        `${p.date} * ${quote(p.payee)} ${quote(p.invoice)}`,
        `  arc-tx: ${quote(p.txHash)}`,
        `  claim-id: ${quote(p.claimId)}`,
        `  decision-hash: ${quote(p.decisionHash)}`,
        `  payout: ${quote(p.payout)}`,
        `  ${payeeAccount(p.payee, p.payout.slice(2, 8))}  ${usdcAmount(p.amount)} USDC`,
        `  ${treasury}  ${usdcAmount(-p.amount)} USDC`,
        "",
      );
      running -= p.amount;
    }
    if (closing) {
      out.push(
        `${nextDay(day)} balance ${treasury}  ${usdcAmount(closing.amount)} ~ 0.000001 USDC`,
        `  block: ${quote(closing.block)}`,
        "",
      );
    }
  }
  return out.join("\n");
}
