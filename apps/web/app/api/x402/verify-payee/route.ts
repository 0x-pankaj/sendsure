import { lookupPayee } from "../../../../lib/lookup";
import { toAddress, toObject } from "../../../../lib/relayer";
import { withPayment } from "../../../../lib/x402";

export const dynamic = "force-dynamic";

/** Paid (x402, Circle Gateway): { org, address } -> is this the address this payee proved? $0.001. */
export function POST(req: Request) {
  return withPayment(req, {
    price: "$0.001",
    description: "SendSure Verification of Payee: is this the payout address the payee proved for this org, right now?",
    run: async (body) => {
      const b = toObject(body);
      return lookupPayee(toAddress(b.org, "org"), toAddress(b.address, "address"));
    },
  });
}
