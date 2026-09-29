import { checkPayout, parsePayoutCsv } from "@sendsure/core";
import { toObject } from "../../../../lib/relayer";
import { withPayment } from "../../../../lib/x402";

export const dynamic = "force-dynamic";

/** Paid (x402, Circle Gateway): a payout CSV (+ last paid) -> PAY / REVIEW / STOP per row. $0.005. */
export function POST(req: Request) {
  return withPayment(req, {
    price: "$0.005",
    description: "SendSure payout check: changed wallets, look-alike (poisoned) addresses, duplicates and amount jumps, per row.",
    run: async (body) => {
      const b = toObject(body);
      if (typeof b.payout_csv !== "string" || !b.payout_csv.trim()) throw new Error("payout_csv is required");
      if (b.payout_csv.length > 200_000) throw new Error("payout_csv is too long");
      const current = parsePayoutCsv(b.payout_csv);
      const last = typeof b.last_paid_csv === "string" ? parsePayoutCsv(b.last_paid_csv) : { rows: [], warnings: [] as string[] };
      const out = checkPayout(current.rows, last.rows);
      return {
        summary: out.summary,
        rows: out.rows.map((r) => ({
          line: r.line,
          payee: r.payee,
          address: r.address,
          amount: r.amount,
          action: r.action,
          status: r.status,
          flags: r.flags,
          explanation: r.explanation,
        })),
        warnings: [...current.warnings, ...last.warnings],
      };
    },
  });
}
