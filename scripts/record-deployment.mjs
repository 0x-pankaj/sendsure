// Writes deployments/arc-<network>.json from Foundry's broadcast of script/Deploy.s.sol (same shape as
// arc-testnet.json), then `pnpm gen` picks it up. Run after the deploy: node scripts/record-deployment.mjs mainnet
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, http, parseAbi } from "viem";

const network = process.argv[2] === "testnet" ? "testnet" : "mainnet";
const net = {
  mainnet: { name: "Arc mainnet", chainId: 5042, rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" },
  testnet: { name: "Arc testnet", chainId: 5042002, rpc: "https://rpc.testnet.arc.io", explorer: "https://explorer.testnet.arc.io" },
}[network];
const root = new URL("..", import.meta.url).pathname;
const run = JSON.parse(readFileSync(`${root}contracts/broadcast/Deploy.s.sol/${net.chainId}/run-latest.json`, "utf8"));

const created = (name) => {
  const tx = run.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === name);
  if (!tx) throw new Error(`${name} is not in the broadcast`);
  return { address: getAddress(tx.contractAddress), deployTx: tx.hash };
};
const registry = created("PayeeRegistry");
const factory = created("MandateFactory");
const setFactory = run.transactions.find((t) => t.transactionType === "CALL" && t.function?.startsWith("setFactory"));
const receipt = run.receipts.find((r) => r.transactionHash === registry.deployTx);

// RECORD_RPC_URL: read from a local fork instead (scripts/rehearse-mainnet.sh).
const client = createPublicClient({ transport: http(process.env.RECORD_RPC_URL || net.rpc) });
const implementation = await client.readContract({
  address: factory.address,
  abi: parseAbi(["function implementation() view returns (address)"]),
  functionName: "implementation",
});
const deployer = getAddress(run.transactions[0].transaction.from);
const url = (a) => `${net.explorer}/address/${a}`;

const out = {
  network: net.name,
  chainId: net.chainId,
  explorer: net.explorer,
  deployedAtUtc: new Date(Number(run.timestamp) * (run.timestamp > 1e12 ? 1 : 1000)).toISOString().replace(".000Z", "+00:00"),
  block: Number(receipt.blockNumber),
  sourceCommit: execSync("git rev-parse HEAD", { cwd: root }).toString().trim(),
  deployer,
  usdc: "0x3600000000000000000000000000000000000000",
  contracts: {
    PayeeRegistry: { ...registry, verified: false, url: url(registry.address) },
    MandateFactory: { ...factory, verified: false, url: url(factory.address) },
    MandateImplementation: { address: getAddress(implementation), deployedBy: "MandateFactory constructor", verified: false, url: url(implementation) },
  },
  setFactoryTx: setFactory?.hash ?? null,
  // From a local fork (scripts/rehearse-mainnet.sh), never the real chain: pnpm gen refuses it unless told otherwise.
  ...(process.env.RECORD_RPC_URL ? { rehearsal: true } : {}),
};
writeFileSync(`${root}deployments/arc-${network}.json`, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote deployments/arc-${network}.json`, out.contracts.PayeeRegistry.address, out.contracts.MandateFactory.address);
