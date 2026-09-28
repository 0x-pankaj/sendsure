// Server only. The data for an org's books, read from the chain: each payment from its Settled event,
// and the treasury's closing balance on each payment day (archive state at that day's last block).
// Payee names are added in the browser; the server never has them.
import { erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { arcTestnet, deployment, mandateAbi } from "@sendsure/chain";
import { getDb } from "./db";
import { serverClient } from "./relayer";

const day = (unix: bigint | number) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);

/** The last block at or before a unix time, from the Arc explorer (Blockscout API). */
async function blockAtOrBefore(unix: number): Promise<bigint | null> {
  try {
    const url = `${arcTestnet.blockExplorers.default.url}/api?module=block&action=getblocknobytime&timestamp=${unix}&closest=before`;
    const out = (await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).json()) as {
      result?: { blockNumber?: string };
    };
    return out.result?.blockNumber ? BigInt(out.result.blockNumber) : null;
  } catch {
    return null;
  }
}

export async function orgBooks(org: Address) {
  const db = await getDb();
  const treasury = await serverClient.readContract({ address: org, abi: mandateAbi, functionName: "treasury" });
  const rows = await db.all<{ claim_id: Hex; payee_ref: Hex; invoice_ref: string; settle_tx: Hex }>(
    "SELECT claim_id, payee_ref, invoice_ref, settle_tx FROM claims WHERE org = ? AND status = 'settled' AND settle_tx IS NOT NULL ORDER BY updated_at",
    org,
  );
  const payments = [];
  for (const r of rows) {
    const receipt = await serverClient.getTransactionReceipt({ hash: r.settle_tx });
    const ev = parseEventLogs({
      abi: mandateAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === org.toLowerCase()),
      eventName: "Settled",
    }).find((e) => e.args.claimId === r.claim_id);
    if (!ev) continue;
    const block = await serverClient.getBlock({ blockNumber: receipt.blockNumber });
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
  const latest = await serverClient.getBlockNumber();
  const balances = [];
  for (const d of [...new Set(payments.map((p) => p.date))].sort()) {
    const endOfDay = Math.floor(Date.parse(`${d}T23:59:59Z`) / 1000);
    const blockNumber = endOfDay >= now ? latest : ((await blockAtOrBefore(endOfDay)) ?? latest);
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
