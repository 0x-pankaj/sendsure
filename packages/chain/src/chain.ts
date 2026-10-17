import { defineChain } from "viem";
import { deployments, type Deployment } from "./generated";

/** Arc testnet. USDC is the native gas token (18-decimal native view; 6-decimal ERC-20 view at 0x3600…). */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

/** Arc mainnet (live Sep 16, 2026). Same USDC address and decimals as testnet. Real money. */
export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export type ArcNetwork = "testnet" | "mainnet";
/**
 * Which Arc chain this build talks to. Testnet unless built with NEXT_PUBLIC_ARC_NETWORK=mainnet (the mainnet
 * beta: a separate Worker and database). Written out in full so Next inlines it in the browser bundle.
 */
export const ARC_NETWORK: ArcNetwork = process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = ARC_NETWORK === "mainnet";
/** The chain this build uses. */
export const arc = IS_MAINNET ? arcMainnet : arcTestnet;
/** For people: "Arc testnet" or "Arc mainnet". */
export const NETWORK_NAME = IS_MAINNET ? "Arc mainnet" : "Arc testnet";

const selected = IS_MAINNET ? deployments.mainnet : deployments.testnet;
if (!selected) throw new Error("No Arc mainnet deployment yet: deploy the contracts, write deployments/arc-mainnet.json, run pnpm gen.");
/** The SendSure contracts on the chain this build uses. */
export const deployment: Deployment = selected;

export const explorerTx = (hash: string) => `${arc.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (address: string) => `${arc.blockExplorers.default.url}/address/${address}`;
