// Server only. The data for an org's books, read from the chain: each payment from its Settled event,
// and the treasury's closing balance on each payment day (archive state at that day's last block).
// Payee names are added in the browser; the server never has them.
import { erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { arc, deployment, mandateAbi } from "@sendsure/chain";
import { getDb } from "./db";
import { serverClient } from "./relayer";

const day = (unix: bigint | number) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);

interface KnownBlock {
  number: bigint;
  timestamp: bigint;
}

/** The last block at or before a unix time, from the Arc explorer (Blockscout API). */
async function explorerBlockAtOrBefore(unix: number): Promise<bigint | null> {
  try {
    const url = `${arc.blockExplorers.default.url}/api?module=block&action=getblocknobytime&timestamp=${unix}&closest=before`;
    const out = (await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json()) as {
      result?: { blockNumber?: string };
    };
    return out.result?.blockNumber ? BigInt(out.result.blockNumber) : null;
  } catch {
    return null;
  }
}

/**
 * The same over RPC, for when the explorer can't be reached (on mainnet it blocks servers): a search between a
 * block known to be at or before the time and one known to be after it. Arc's blocks come at a steady pace, so
 * guessing from the times usually lands in a few reads; every third step halves the range, so it always ends.
 */
async function rpcBlockAtOrBefore(unix: bigint, lo: KnownBlock, hi: KnownBlock): Promise<bigint | null> {
  if (hi.timestamp <= unix) return hi.number;
  for (let step = 0; step < 48; step++) {
    if (hi.number - lo.number <= 1n) return lo.number;
    let guess =
      step % 3 === 2
        ? (lo.number + hi.number) / 2n
        : lo.number + ((unix - lo.timestamp) * (hi.number - lo.number)) / (hi.timestamp - lo.timestamp);
    if (guess <= lo.number) guess = lo.number + 1n;
    if (guess >= hi.number) guess = hi.number - 1n;
    const b = await serverClient.getBlock({ blockNumber: guess });
    if (b.timestamp <= unix) lo = { number: guess, timestamp: b.timestamp };
    else hi = { number: guess, timestamp: b.timestamp };
  }
  return null;
}

export async function orgBooks(org: Address) {
  const db = await getDb();
  const treasury = await serverClient.readContract({ address: org, abi: mandateAbi, functionName: "treasury" });
  const rows = await db.all<{ claim_id: Hex; payee_ref: Hex; invoice_ref: string; settle_tx: Hex }>(
    "SELECT claim_id, payee_ref, invoice_ref, settle_tx FROM claims WHERE org = ? AND status = 'settled' AND settle_tx IS NOT NULL ORDER BY updated_at",
    org,
  );
  const payments = [];
  // Each payment day's last payment block: the search for that day's closing block starts from it.
  const lastPaymentBlock = new Map<string, KnownBlock>();
  for (const r of rows) {
    const receipt = await serverClient.getTransactionReceipt({ hash: r.settle_tx });
    const ev = parseEventLogs({
      abi: mandateAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === org.toLowerCase()),
      eventName: "Settled",
    }).find((e) => e.args.claimId === r.claim_id);
    if (!ev) continue;
    const block = await serverClient.getBlock({ blockNumber: receipt.blockNumber });
    const known = lastPaymentBlock.get(day(block.timestamp));
    if (!known || block.number > known.number) lastPaymentBlock.set(day(block.timestamp), { number: block.number, timestamp: block.timestamp });
    payments.push({
      date: day(block.timestamp),
      payeeRef: r.payee_ref,
      invoice: r.invoice_ref,
      amount: ev.args.amount.toString(),
      txHash: r.settle_tx,
      claimId: r.claim_id,
      decisionHash: ev.args.decisionHash,
      payout: ev.args.payout,
      block: receipt.blockNumber.toString(),
    });
  }
  const now = Math.floor(Date.now() / 1000);
  const latestBlock = await serverClient.getBlock({ blockTag: "latest" });
  const latest = latestBlock.number;
  const balances = [];
  for (const d of [...new Set(payments.map((p) => p.date))].sort()) {
    const endOfDay = Math.floor(Date.parse(`${d}T23:59:59Z`) / 1000);
    const from = lastPaymentBlock.get(d);
    const blockNumber =
      endOfDay >= now
        ? latest
        : ((await explorerBlockAtOrBefore(endOfDay)) ??
          (from
            ? await rpcBlockAtOrBefore(BigInt(endOfDay), from, { number: latest, timestamp: latestBlock.timestamp }).catch(() => null)
            : null));
    // A closed day whose closing block can't be found gets no balance: a balance at the wrong block would make
    // the books invent movements outside SendSure.
    if (blockNumber === null) continue;
    const amount = await serverClient.readContract({
      address: deployment.usdc as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [treasury],
      blockNumber,
    });
    balances.push({ day: d, amount: amount.toString(), block: blockNumber.toString(), closed: endOfDay < now });
  }
  return { org, treasury, payments, balances };
}
