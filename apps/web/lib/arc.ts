import { createPublicClient, http } from "viem";
import { arcTestnet } from "@sendsure/chain";

/** Read-only Arc testnet client for the browser, through SendSure's /api/rpc (Arc's public RPC can go away). */
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http("/api/rpc") });
