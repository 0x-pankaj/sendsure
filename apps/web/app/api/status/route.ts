import { formatEther, type Address } from "viem";
import { IS_MAINNET, NETWORK_NAME, SENDSURE_AGENTS, arc, deployment } from "@sendsure/chain";
import { getDb } from "../../../lib/db";
import { limitIp, respond } from "../../../lib/http";
import { faucetAddress } from "../../../lib/faucet";
import { serverClient } from "../../../lib/relayer";

export const dynamic = "force-dynamic";

const balance = (address: string) =>
  serverClient
    .getBalance({ address: address as Address })
    .then((b) => formatEther(b))
    .catch(() => null);

/** Public health: the chain, the database, the indexer, and the gas left in each SendSure key. */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "status", 120);
    const [block, db] = await Promise.all([
      serverClient.getBlockNumber().catch(() => null),
      getDb()
        .then((d) =>
          d.first<{ block: number; updated_at: number }>("SELECT block, updated_at FROM indexer_cursor WHERE name = 'main'"),
        )
        .catch(() => undefined),
    ]);
    const relayer = process.env.RELAYER_ADDRESS ?? (IS_MAINNET ? "0x51c38105b546bE9BD7cD420743778Dc74f89Cf19" : "0x1B66e68D3F61D84B5498013b0981537DBef28b73");
    return {
      chain: { name: NETWORK_NAME, id: arc.id, latestBlock: block?.toString() ?? null },
      database: db === undefined ? "unreachable" : "ok",
      indexer: db ? { block: db.block, updatedAt: db.updated_at, behindBlocks: block ? Number(block) - db.block : null } : null,
      keys: {
        relayer: { address: relayer, usdc: await balance(relayer) },
        serverAgent: { address: SENDSURE_AGENTS.serverAgent, usdc: await balance(SENDSURE_AGENTS.serverAgent) },
        ...(SENDSURE_AGENTS.circleAgentWallet
          ? { circleAgentWallet: { address: SENDSURE_AGENTS.circleAgentWallet, usdc: await balance(SENDSURE_AGENTS.circleAgentWallet) } }
          : {}),
        ...(faucetAddress() ? { faucet: { address: faucetAddress()!, usdc: await balance(faucetAddress()!) } } : {}),
      },
      contracts: { payeeRegistry: deployment.payeeRegistry, mandateFactory: deployment.mandateFactory, usdc: deployment.usdc },
      commit: process.env.NEXT_PUBLIC_COMMIT_SHA ?? null,
    };
  });
}
