import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { ledgerDays, toHledger, toJournalCsv, toLedger, toStatementCsv } from "../src/index";
import { SAMPLE } from "./fixtures";

const units = (s: string) => (s ? BigInt(s.replace(".", "")) : 0n);

describe("ledger exports", () => {
  it("computes outside movements from the chain balance, day by day", () => {
    const days = ledgerDays(SAMPLE);
    expect(days.map((d) => d.outside)).toEqual([700_000n, 100_000_000n]);
    expect(days[1]!.closing).toEqual({ amount: 87_899_999n, block: "200" });
  });

  it("hledger: six decimals, the Arc tx on each payment, and a balance assertion per day", () => {
    const text = toHledger(SAMPLE);
    expect(text).toContain("commodity 1000.000000 USDC");
    expect(text).toContain("2026-09-29 * North Star Design | INV-7");
    expect(text).toContain("    ; arc-tx: 0xbbb");
    expect(text).toContain("    Expenses:Contractors:North-Star-Design  12.500001 USDC");
    expect(text).toContain("    Assets:Arc:Treasury  0 USDC = 87.899999 USDC");
  });

  it("hledger: a payee name cannot break the entry", () => {
    const text = toHledger({ ...SAMPLE, payments: [{ ...SAMPLE.payments[0]!, payee: "Evil; name | x\n2026-01-01 * hack" }] });
    expect(text).toContain("2026-09-28 * Evil name x 2026-01-01 * hack | INV-A");
  });

  it("journal CSV: every entry balances and the whole file balances", () => {
    const rows = Papa.parse<Record<string, string>>(toJournalCsv(SAMPLE), { header: true }).data;
    expect(rows).toHaveLength(8);
    const byEntry = new Map<string, bigint>();
    for (const r of rows) byEntry.set(r.entry!, (byEntry.get(r.entry!) ?? 0n) + units(r.debit!) - units(r.credit!));
    expect([...byEntry.values()].every((v) => v === 0n)).toBe(true);
    expect(rows.find((r) => r.arc_tx === "0xbbb" && r.debit)?.debit).toBe("12.500001");
  });

  it("statement CSV: money out is negative, the tx is the reference, sub-cent amounts are counted", () => {
    const { csv, beyondCents } = toStatementCsv(SAMPLE);
    const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(Object.keys(rows[0]!)).toEqual(["Date", "Amount", "Payee", "Description", "Reference"]);
    expect(rows.find((r) => r.Reference === "0xaaa")?.Amount).toBe("-0.300000");
    expect(rows.find((r) => r.Reference === "0xbbb")?.Amount).toBe("-12.500001");
    expect(beyondCents).toBe(1);
    // The statement's net movement equals the last closing balance.
    expect(rows.reduce((sum, r) => sum + units(r.Amount!.replace("-", "")) * (r.Amount!.startsWith("-") ? -1n : 1n), 0n)).toBe(87_899_999n);
  });

  it("all formats come from the same movements", () => {
    expect(toLedger("hledger", SAMPLE)).toBe(toHledger(SAMPLE));
    expect(toLedger("beancount", SAMPLE)).toContain('option "operating_currency" "USDC"');
  });
});
