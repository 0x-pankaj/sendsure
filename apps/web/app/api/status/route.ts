import { formatEther, type Address } from "viem";
import { SENDSURE_AGENTS, deployment } from "@sendsure/chain";
import { getDb } from "../../../lib/db";
import { limitIp, respond } from "../../../lib/http";
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
    const relayer = process.env.RELAYER_ADDRESS ?? "0x1B66e68D3F61D84B5498013b0981537DBef28b73";
    return {
      chain: { name: "Arc testnet", id: 5042002, latestBlock: block?.toString() ?? null },
      database: db === undefined ? "unreachable" : "ok",
      indexer: db ? { block: db.block, updatedAt: db.updated_at, behindBlocks: block ? Number(block) - db.block : null } : null,
      keys: {
        relayer: { address: relayer, usdc: await balance(relayer) },
        serverAgent: { address: SENDSURE_AGENTS.serverAgent, usdc: await balance(SENDSURE_AGENTS.serverAgent) },
        circleAgentWallet: { address: SENDSURE_AGENTS.circleAgentWallet, usdc: await balance(SENDSURE_AGENTS.circleAgentWallet) },
      },
      contracts: { payeeRegistry: deployment.payeeRegistry, mandateFactory: deployment.mandateFactory, usdc: deployment.usdc },
      commit: process.env.NEXT_PUBLIC_COMMIT_SHA ?? null,
    };
  });
}
