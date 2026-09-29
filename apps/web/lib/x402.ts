// Server only. SendSure as a paid service for other agents: x402 over Circle Gateway Nanopayments.
// A call without payment gets 402 with the payment requirements (every Gateway-supported testnet,
// so a buyer can pay from whichever chain holds its Gateway balance). A paid retry carries the
// PAYMENT-SIGNATURE header: Circle Gateway verifies and settles it (gasless, batched), then the
// handler runs. This mirrors @circle-fin/x402-batching's Express middleware on Web Request/Response.
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { getDb } from "./db";

const FACILITATOR = process.env.GATEWAY_FACILITATOR_URL || "https://gateway-api-testnet.circle.com";
/** Fees go to the relayer: what other agents pay helps fund the gas SendSure sponsors. */
const PAY_TO = process.env.X402_PAY_TO || process.env.RELAYER_ADDRESS || "0x1B66e68D3F61D84B5498013b0981537DBef28b73";
const VALIDITY_SECONDS = 7 * 24 * 60 * 60 + 100; // Gateway's minimum authorization window plus buffer

interface Kind {
  network: string;
  extra?: { verifyingContract?: string; assets?: { symbol: string; address: string }[] };
}
interface Requirement {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

let facilitator: BatchFacilitatorClient | undefined;
let kinds: { at: number; list: Kind[] } | undefined;

async function supportedKinds(): Promise<Kind[]> {
  facilitator ??= new BatchFacilitatorClient({ url: FACILITATOR });
  if (!kinds || Date.now() - kinds.at > 10 * 60_000) {
    const list = ((await facilitator.getSupported()).kinds as Kind[]).filter((k) => k.extra?.verifyingContract);
    kinds = { at: Date.now(), list };
  }
  return kinds.list;
}

/** "$0.001" -> "1000" (USDC atomic units). */
export const atomic = (price: string) => String(Math.round(Number(price.replace("$", "")) * 1e6));

function requirement(kind: Kind, price: string): Requirement | null {
  const usdc = kind.extra?.assets?.find((a) => a.symbol === "USDC")?.address;
  if (!usdc || !kind.extra?.verifyingContract) return null;
  return {
    scheme: "exact",
    network: kind.network,
    asset: usdc,
    amount: atomic(price),
    payTo: PAY_TO,
    maxTimeoutSeconds: VALIDITY_SECONDS,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: kind.extra.verifyingContract },
  };
}

const b64json = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export interface PaidRoute {
  price: string;
  description: string;
  /** The paid work; runs only after Gateway settled the payment. Throw to refuse bad input (400). */
  run: (body: unknown) => Promise<unknown>;
}

export async function withPayment(req: Request, route: PaidRoute): Promise<Response> {
  const header = req.headers.get("payment-signature");
  const all = await supportedKinds();
  if (!header) {
    const accepts = all.map((k) => requirement(k, route.price)).filter(Boolean);
    if (!accepts.length) return json({ error: "No payment networks available" }, 503);
    const required = {
      x402Version: 2,
      resource: { url: new URL(req.url).pathname, description: route.description, mimeType: "application/json" },
      accepts,
    };
    return json({ price: route.price, description: route.description, pay: "x402 over Circle Gateway" }, 402, {
      "PAYMENT-REQUIRED": b64json(required),
    });
  }

  let payload: { accepted?: { network?: string }; payload: Record<string, unknown>; x402Version: number };
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return json({ error: "Unreadable PAYMENT-SIGNATURE header" }, 400);
  }
  const kind = all.find((k) => k.network === payload.accepted?.network);
  const reqs = kind ? requirement(kind, route.price) : null;
  if (!reqs) return json({ error: `Network ${payload.accepted?.network ?? "?"} not accepted` }, 400);

  // Validate the input before taking money for it.
  const body = await req.json().catch(() => null);
  let result: unknown;
  const check = await route.run(body).then(
    (r) => ((result = r), null),
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  if (check !== null) return json({ error: check, charged: false }, 400);

  const verified = await facilitator!.verify(payload as never, reqs as never);
  if (!verified.isValid) return json({ error: "Payment verification failed", reason: verified.invalidReason }, 402);
  const settled = await facilitator!.settle(payload as never, reqs as never);
  if (!settled.success) return json({ error: "Payment settlement failed", reason: settled.errorReason }, 402);

  const payer = settled.payer ?? verified.payer ?? "";
  const db = await getDb();
  await db
    .run(
      "INSERT OR IGNORE INTO x402_payments (id, endpoint, payer, network, amount, settlement, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      crypto.randomUUID(),
      new URL(req.url).pathname,
      payer,
      reqs.network,
      reqs.amount,
      settled.transaction ?? null,
      Math.floor(Date.now() / 1000),
    )
    .catch(() => undefined);
  return json(result, 200, {
    "PAYMENT-RESPONSE": b64json({ success: true, transaction: settled.transaction, network: reqs.network, payer }),
  });
}
