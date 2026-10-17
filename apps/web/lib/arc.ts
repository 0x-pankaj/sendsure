import { createPublicClient, http } from "viem";
import { arc } from "@sendsure/chain";

/** Read-only Arc testnet client for the browser, through SendSure's /api/rpc (Arc's public RPC can go away). */
export const publicClient = createPublicClient({ chain: arc, transport: http("/api/rpc") });
