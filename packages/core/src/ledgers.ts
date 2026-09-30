// The same books as the beancount export, in other shapes: an hledger journal, a general-journal CSV
// and a bank-statement CSV. Pure (runs in the browser, where payee names live).
//
// All three are built from one list of movements, so they agree with each other line for line.
// Amounts always carry six decimals: nothing is rounded on the way out.
import { payeeAccount, toBeancount, usdcAmount, type LedgerInput, type LedgerPayment } from "./beancount";
import { toCsv } from "./csv";

const TREASURY = "Assets:Arc:Treasury";
const OTHER = "Equity:Treasury-Other-Flows";
const OUTSIDE_TEXT = "Movements outside SendSure (deposits, gas, other transfers), from the chain balance";

export interface LedgerDay {
  day: string;
  /** What moved the treasury outside SendSure that day, computed from the chain balance. 0 if unknown. */
  outside: bigint;
  payments: LedgerPayment[];
  /** The treasury's balance at the day's last block, if the chain was read for it. */
  closing?: { amount: bigint; block: string };
}

/** The ledger day by day: outside movements first, then each payment, then the closing balance. */
export function ledgerDays(input: LedgerInput): LedgerDay[] {
  const payments = [...input.payments].sort((a, b) => a.date.localeCompare(b.date) || a.txHash.localeCompare(b.txHash));
  const balanceOf = new Map(input.balances.map((b) => [b.day, b]));
  let running = 0n;
  return [...new Set(payments.map((p) => p.date))].sort().map((day) => {
    const today = payments.filter((p) => p.date === day);
    const paid = today.reduce((sum, p) => sum + p.amount, 0n);
    const closing = balanceOf.get(day);
    const outside = closing ? closing.amount - (running - paid) : 0n;
    running += outside - paid;
    return { day, outside, payments: today, closing: closing && { amount: closing.amount, block: closing.block } };
  });
}

const accountOf = (p: LedgerPayment) => payeeAccount(p.payee, p.payout.slice(2, 8));

/** hledger reads "payee | note"; a ";" would start a comment and a newline would end the entry. */
const plain = (s: string) => s.replace(/[|;\r\n]+/g, " ").replace(/\s+/g, " ").trim();

/** An hledger journal (also plain-text accounting: one entry per payment, balances asserted from the chain). */
export function toHledger(input: LedgerInput): string {
  const days = ledgerDays(input);
  const accounts = [...new Set(days.flatMap((d) => d.payments.map(accountOf)))].sort();
  const out: string[] = [
    `; SendSure books: ${plain(input.title)}`,
    `; Org ${input.org} on Arc testnet. Treasury ${input.treasury}.`,
    "; Each payment carries its claim id, the agent's decision hash and its Arc transaction.",
    "; Balances come from the chain; movements outside SendSure are computed from them, never guessed.",
    "",
    "commodity 1000.000000 USDC",
    "",
    `account ${TREASURY}`,
    `account ${OTHER}`,
    ...accounts.map((a) => `account ${a}`),
    "",
  ];
  for (const d of days) {
    if (d.outside !== 0n) {
      out.push(
        `${d.day} * Treasury | ${OUTSIDE_TEXT}`,
        `    ${TREASURY}  ${usdcAmount(d.outside)} USDC`,
        `    ${OTHER}`,
        "",
      );
    }
    for (const p of d.payments) {
      out.push(
        `${p.date} * ${plain(p.payee)} | ${plain(p.invoice)}`,
        `    ; arc-tx: ${p.txHash}`,
        `    ; claim-id: ${p.claimId}`,
        `    ; decision-hash: ${p.decisionHash}`,
        `    ; payout: ${p.payout}`,
        `    ${accountOf(p)}  ${usdcAmount(p.amount)} USDC`,
        `    ${TREASURY}  ${usdcAmount(-p.amount)} USDC`,
        "",
      );
    }
    if (d.closing) {
      out.push(
        `${d.day} * Treasury | Closing balance from the chain, block ${d.closing.block}`,
        `    ${TREASURY}  0 USDC = ${usdcAmount(d.closing.amount)} USDC`,
        "",
      );
    }
  }
  return out.join("\n");
}

/** A general journal as CSV: two lines per entry, debits equal credits, every payment with its Arc transaction. */
export function toJournalCsv(input: LedgerInput): string {
  const rows: Record<string, string>[] = [];
  let entry = 0;
  const line = (date: string, account: string, amount: bigint, rest: Partial<Record<string, string>>) =>
    rows.push({
      date,
      entry: String(entry),
      account,
      debit: amount > 0n ? usdcAmount(amount) : "",
      credit: amount < 0n ? usdcAmount(-amount) : "",
      currency: "USDC",
      payee: rest.payee ?? "",
      description: rest.description ?? "",
      invoice: rest.invoice ?? "",
      arc_tx: rest.arc_tx ?? "",
      claim_id: rest.claim_id ?? "",
      decision_hash: rest.decision_hash ?? "",
      payout_address: rest.payout_address ?? "",
    });
  for (const d of ledgerDays(input)) {
    if (d.outside !== 0n) {
      entry++;
      line(d.day, TREASURY, d.outside, { description: OUTSIDE_TEXT });
      line(d.day, OTHER, -d.outside, { description: OUTSIDE_TEXT });
    }
    for (const p of d.payments) {
      entry++;
      const rest = {
        payee: p.payee,
        description: `SendSure payment, invoice ${p.invoice}`,
        invoice: p.invoice,
        arc_tx: p.txHash,
        claim_id: p.claimId,
        decision_hash: p.decisionHash,
        payout_address: p.payout,
      };
      line(p.date, accountOf(p), p.amount, rest);
      line(p.date, TREASURY, -p.amount, rest);
    }
  }
  return toCsv(rows);
}

export interface StatementCsv {
  csv: string;
  /** Rows whose amount needs more than two decimals. Tools that keep cents would round them: check these by hand. */
  beyondCents: number;
}

/**
 * The treasury's movements as a bank-statement CSV (Date, Amount, Payee, Description, Reference), for tools
 * that reconcile from a statement import. Money out is negative. The Arc transaction is the reference.
 */
export function toStatementCsv(input: LedgerInput): StatementCsv {
  const rows: Record<string, string>[] = [];
  let beyondCents = 0;
  const add = (date: string, amount: bigint, payee: string, description: string, reference: string) => {
    if (amount % 10_000n !== 0n) beyondCents++;
    rows.push({ Date: date, Amount: usdcAmount(amount), Payee: payee, Description: description, Reference: reference });
  };
  for (const d of ledgerDays(input)) {
    if (d.outside !== 0n) add(d.day, d.outside, "", OUTSIDE_TEXT, d.closing ? `block ${d.closing.block}` : "");
    for (const p of d.payments) add(p.date, -p.amount, p.payee, `SendSure payment, invoice ${p.invoice}`, p.txHash);
  }
  return { csv: toCsv(rows), beyondCents };
}

export const LEDGER_FORMATS = {
  beancount: { label: "beancount", extension: "beancount", mime: "text/plain" },
  hledger: { label: "hledger", extension: "journal", mime: "text/plain" },
  journal: { label: "Journal (CSV)", extension: "journal.csv", mime: "text/csv" },
  statement: { label: "Bank statement (CSV)", extension: "statement.csv", mime: "text/csv" },
} as const;
export type LedgerFormat = keyof typeof LEDGER_FORMATS;

/** The books in one of the formats above, as the file's text. */
export function toLedger(format: LedgerFormat, input: LedgerInput): string {
  if (format === "hledger") return toHledger(input);
  if (format === "journal") return toJournalCsv(input);
  if (format === "statement") return toStatementCsv(input).csv;
  return toBeancount(input);
}
