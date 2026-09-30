import Papa from "papaparse";

export interface PayoutRow {
  /** 1-based line number in the source file (header = line 1). */
  line: number;
  /** Payee name as written. Falls back to the address when the file has no name column. */
  payee: string;
  address: string;
  amount: number | null;
  token?: string;
  chain?: string;
  reference?: string;
}

export interface ParsedFile {
  rows: PayoutRow[];
  columns: Partial<Record<keyof Omit<PayoutRow, "line">, string>>;
  warnings: string[];
}

const SYNONYMS: Record<keyof Omit<PayoutRow, "line">, string[]> = {
  payee: ["payee", "name", "vendor", "contractor", "recipient name", "beneficiary", "contributor", "payee name", "vendor name"],
  address: ["address", "wallet", "wallet address", "payout address", "receiver", "recipient", "to", "destination", "account", "recipient address"],
  amount: ["amount", "value", "usdc", "total", "payment", "sum", "amount usdc"],
  token: ["token", "currency", "asset", "token_address", "token address"],
  chain: ["chain", "network", "blockchain"],
  reference: ["reference", "invoice", "memo", "note", "ref", "description", "id", "invoice number"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");

/** Parse a payout CSV (Safe CSV-airdrop, Disperse-style, or a spreadsheet export). Never throws on bad rows. */
export function parsePayoutCsv(text: string): ParsedFile {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const columns: ParsedFile["columns"] = {};
  for (const field of Object.keys(SYNONYMS) as (keyof typeof SYNONYMS)[]) {
    const hit = headers.find((h) => SYNONYMS[field].includes(norm(h)));
    if (hit) columns[field] = hit;
  }
  const warnings: string[] = [];
  if (!columns.address) warnings.push("No address column found (looked for: address, wallet, receiver, recipient, to).");
  if (!columns.amount) warnings.push("No amount column found; amounts will not be checked.");

  const rows: PayoutRow[] = [];
  parsed.data.forEach((raw, i) => {
    const get = (f: keyof typeof SYNONYMS) => (columns[f] ? String(raw[columns[f]!] ?? "").trim() : "");
    const address = get("address");
    if (!address) {
      warnings.push(`Line ${i + 2}: no address, skipped.`);
      return;
    }
    const amountText = get("amount").replace(/[,$€\s]/g, "").replace(/usdc|eurc/gi, "");
    const amount = amountText === "" ? null : Number(amountText);
    rows.push({
      line: i + 2,
      payee: get("payee") || address,
      address,
      amount: amount === null || Number.isNaN(amount) ? null : amount,
      token: get("token") || undefined,
      chain: get("chain") || undefined,
      reference: get("reference") || undefined,
    });
  });
  return { rows, columns, warnings };
}

export function toCsv(records: Record<string, string | number | null | undefined>[]): string {
  return Papa.unparse(records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ""]))));
}

/** Any CSV with a header row, as one record per line. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true }).data;
}
