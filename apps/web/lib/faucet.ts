// Server only. The testnet faucet: one small drip of test USDC per wallet, so a new team can try a real payout
// (budget, co-sign, payment) without leaving SendSure for an outside faucet. Testnet only; the USDC has no value.
//
// Limits: the wallet must be signed in (its own signature), hold less than 1 USDC, and never have had a drip;
// at most 3 drips per network a day and 60 USDC a day in total. Arc's gas token is USDC, so a drip is a plain
// native transfer from the faucet key, which holds no role in any contract.
import { createWalletClient, formatEther, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, explorerTx } from "@sendsure/chain";
import { getDb } from "./db";
import { RelayError, sendAndWait, serverClient } from "./relayer";
import { arcTransport } from "./rpc";

export const DRIP_USDC = "2";
const MAX_BALANCE = parseEther("1");
const PER_NETWORK_PER_DAY = 3;
const GLOBAL_PER_DAY_USDC = 60;
const DAY = 86_400;

export interface DripCheck {
  balance: bigint;
  alreadyDripped: boolean;
  networkToday: number;
  globalTodayUsdc: number;
}

/** Why this wallet cannot get a drip right now, or null. Pure, so it is tested on its own. */
export function dripRefusal(c: DripCheck): string | null {
  if (c.alreadyDripped) return "This wallet already got test USDC from SendSure. For more, use faucet.circle.com (pick Arc testnet).";
  if (c.balance >= MAX_BALANCE)
    return `This wallet already holds ${formatEther(c.balance)} test USDC, enough to try SendSure.`;
  if (c.networkToday >= PER_NETWORK_PER_DAY) return "This network already got test USDC several times today. Try faucet.circle.com (pick Arc testnet).";
  if (c.globalTodayUsdc + Number(DRIP_USDC) > GLOBAL_PER_DAY_USDC)
    return "SendSure's faucet is empty for today. Use faucet.circle.com (pick Arc testnet), or try again tomorrow.";
  return null;
}

async function ipHash(ip: string): Promise<string> {
  const salt = process.env.SESSION_SECRET ?? "sendsure";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:faucet:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function makeFaucet() {
  const key = process.env.FAUCET_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new RelayError(503, "The testnet faucet is not set up on this server. Use faucet.circle.com (pick Arc testnet).", "NOT_CONFIGURED");
  // The faucet key only sends test USDC. It holds no role in any contract.
  return createWalletClient({ account: privateKeyToAccount(key as Hex), chain: arc, transport: arcTransport() });
}
let faucetClient: ReturnType<typeof makeFaucet> | undefined;
const faucet = () => (faucetClient ??= makeFaucet());

export function faucetAddress(): Address | null {
  const key = process.env.FAUCET_PRIVATE_KEY;
  return key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as Hex).address : null;
}

export async function faucetStatus(address: Address) {
  const db = await getDb();
  const [balance, row] = await Promise.all([
    serverClient.getBalance({ address }),
    db.first<{ tx: string }>("SELECT tx FROM faucet_drips WHERE lower(address) = lower(?)", address),
  ]);
  return { balance: formatEther(balance), dripped: Boolean(row), canAsk: !row && balance < MAX_BALANCE && Boolean(faucetAddress()) };
}

export async function drip(address: Address, ip: string) {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const hash = await ipHash(ip);
  const [balance, mine, network, global] = await Promise.all([
    serverClient.getBalance({ address }),
    db.first<{ tx: string }>("SELECT tx FROM faucet_drips WHERE lower(address) = lower(?)", address),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM faucet_drips WHERE ip_hash = ? AND created_at > ?", hash, now - DAY),
    db.first<{ total: number }>("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM faucet_drips WHERE created_at > ?", now - DAY),
  ]);
  const refusal = dripRefusal({
    balance,
    alreadyDripped: Boolean(mine),
    networkToday: Number(network?.n ?? 0),
    globalTodayUsdc: Number(global?.total ?? 0),
  });
  if (refusal) throw new RelayError(409, refusal, "FAUCET_REFUSED");
  // Claim the slot first (the address is the primary key), so two quick clicks never send twice.
  try {
    await db.run(
      "INSERT INTO faucet_drips (address, amount, tx, ip_hash, created_at) VALUES (?, ?, 'pending', ?, ?)",
      address.toLowerCase(),
      DRIP_USDC,
      hash,
      now,
    );
  } catch {
    throw new RelayError(409, "This wallet already got test USDC from SendSure.", "FAUCET_REFUSED");
  }
  const wallet = faucet();
  try {
    const sent = await sendAndWait(
      () => wallet.sendTransaction({ to: address, value: parseEther(DRIP_USDC) }),
      wallet.account.address,
    );
    await db.run("UPDATE faucet_drips SET tx = ? WHERE address = ?", sent.txHash, address.toLowerCase());
    return { amount: DRIP_USDC, txHash: sent.txHash, explorer: explorerTx(sent.txHash) };
  } catch {
    await db.run("DELETE FROM faucet_drips WHERE address = ? AND tx = 'pending'", address.toLowerCase());
    throw new RelayError(503, "The faucet could not send right now. Try again in a minute, or use faucet.circle.com.", "FAUCET_FAILED");
  }
}
