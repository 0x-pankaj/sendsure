import { createPublicClient, http } from "viem";
import { arcTestnet } from "@sendsure/chain";

/** Read-only Arc testnet client for the browser (the public RPC allows cross-origin calls). */
export const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
