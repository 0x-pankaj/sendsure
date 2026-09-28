import { defineChain } from "viem";

/** Arc testnet. USDC is the native gas token (18-decimal native view; 6-decimal ERC-20 view at 0x3600…). */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

export const explorerTx = (hash: string) => `${arcTestnet.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (address: string) => `${arcTestnet.blockExplorers.default.url}/address/${address}`;
