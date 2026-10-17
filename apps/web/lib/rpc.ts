import { fallback, http, type Transport } from "viem";

/**
 * The server's Arc RPCs: ARC_RPC_URL, comma-separated for backups (mainnet: Circle's RPC first, then other
 * providers). One RPC is a single point of failure: on Oct 17 the testnet one answered reads but could not
 * send any transaction.
 */
export function arcRpcUrls(): string[] {
  return (process.env.ARC_RPC_URL ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * viem transport over those RPCs: the next one is tried when one fails. A revert or a refused transaction is
 * final and is not retried elsewhere; resending the same signed transaction is safe (same hash, same nonce).
 * No URL set: the chain's default RPC.
 */
export function arcTransport(): Transport {
  const urls = arcRpcUrls();
  return urls.length > 1 ? fallback(urls.map((u) => http(u))) : http(urls[0]);
}
