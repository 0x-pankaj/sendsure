// Server only. SendSure as an MCP server (Streamable HTTP, stateless JSON responses), so another
// agent (e.g. a judge's Claude) can use it as a tool:
//   claude mcp add --transport http sendsure https://sendsure.0xpankaj.workers.dev/api/mcp
// Read-only tools work on any org. The only tool that writes acts on the SANDBOX demo org, is a
// dry run unless dry_run is false, and is idempotent (same key, same result, `replayed: true`).
import { keccak256, toHex, type Hex } from "viem";
import { checkPayout, parsePayoutCsv } from "@sendsure/core";
import { runScene, savedScenes, type Scene } from "./demo";
import { receiptFor } from "./receipt";
import { RelayError, serverClient, toAddress } from "./relayer";
import { stats } from "./stats";
import { indexerTick } from "./indexer";
import { getDb } from "./db";
import { readPayee } from "@sendsure/chain";

export const MCP_PROTOCOL = "2025-06-18";

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
  run: (args: Json) => Promise<Json>;
}

const SCENE_PLANS: Record<Scene, string> = {
  bind: "Open an invite on the sandbox demo org and have a fresh demo payee prove their address by signing (relayer pays gas).",
  attack:
    "Have an attacker sign a claim for the demo payee's work and submit it; the contract refuses it on-chain (BAD_SIGNATURE).",
  change: "Have the attacker try to move the demo payee's payouts to their own wallet; SendSure and the contract refuse it.",
  pay: "The demo payee signs a 0.05 USDC claim; the agent escalates it, the demo approver co-signs, the agent pays; returns a receipt.",
};

/** An MCP session-free idempotency key -> the demo session id (a UUID shape the demo expects). */
function sessionFor(key: string): string {
  const h = keccak256(toHex(`mcp:${key}`)).slice(2, 34);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const TOOLS: Tool[] = [
  {
    name: "check_payout_list",
    title: "Check a payout list",
    description:
      "Compare a stablecoin payout list (CSV with payee, address, amount) with the list paid last time. Flags changed wallets, look-alike (address-poisoning) addresses, duplicates and amount jumps, with PAY / REVIEW / STOP per row. Read-only; nothing is stored.",
    inputSchema: {
      type: "object",
      properties: {
        payout_csv: {
          type: "string",
          description: "This payout, as CSV with a header row (payee/name, address/wallet, amount).",
        },
        last_paid_csv: { type: "string", description: "The previous payout in the same format (optional but recommended)." },
      },
      required: ["payout_csv"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run: async (a) => {
      const current = parsePayoutCsv(String(a.payout_csv ?? ""));
      const last = a.last_paid_csv ? parsePayoutCsv(String(a.last_paid_csv)) : { rows: [], warnings: [] as string[] };
      const out = checkPayout(current.rows, last.rows);
      return {
        summary: out.summary,
        rows: out.rows.map((r) => ({
          line: r.line,
          payee: r.payee,
          address: r.address,
          amount: r.amount,
          action: r.action,
          status: r.status,
          flags: r.flags,
          explanation: r.explanation,
        })),
        warnings: [...current.warnings, ...last.warnings],
      };
    },
  },
  {
    name: "verify_payee_address",
    title: "Is this a proven payee address?",
    description:
      "For a SendSure org (its Mandate contract address) and a wallet address: is this address a payee who proved it for this org, right now, on Arc testnet? Answers yes/no with the proof block; no names or amounts. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "The org's Mandate contract address (0x…)." },
        address: { type: "string" },
      },
      required: ["org", "address"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    run: async (a) => {
      const org = toAddress(a.org, "org");
      const address = toAddress(a.address, "address");
      await indexerTick({ maxWindows: 2, minIntervalSec: 20 }).catch(() => null);
      const db = await getDb();
      const rows = await db.all<{ payee_ref: Hex; block: number }>(
        "SELECT payee_ref, block FROM chain_events WHERE name IN ('Bound','Changed') AND lower(org) = lower(?) AND lower(payout) = lower(?) ORDER BY block DESC LIMIT 10",
        org,
        address,
      );
      for (const r of rows) {
        const p = await readPayee(serverClient, org, r.payee_ref);
        if (p.payout.toLowerCase() === address.toLowerCase() && (p.state === "BOUND" || p.state === "FROZEN")) {
          return { verified: p.state === "BOUND", state: p.state, provenAtBlock: r.block };
        }
      }
      return { verified: false, state: "NOT_A_PROVEN_PAYEE" };
    },
  },
  {
    name: "get_payment_receipt",
    title: "Explain a SendSure payment",
    description:
      "Given an Arc testnet transaction hash, return the SendSure payment receipt from on-chain facts: amount, payee address and the proof they own it, the signed claim id, the agent's decision hash and whether an on-chain anchor covers it. Read-only.",
    inputSchema: { type: "object", properties: { tx_hash: { type: "string" } }, required: ["tx_hash"] },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    run: async (a) => {
      const tx = String(a.tx_hash ?? "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) throw new RelayError(400, "tx_hash must be a transaction hash.", "BAD_INPUT");
      return (await receiptFor(tx as Hex)) as unknown as Json;
    },
  },
  {
    name: "get_sendsure_stats",
    title: "SendSure numbers",
    description:
      "Orgs, proven payees, payments, escalations, refusals, co-signs and anchors, counted from on-chain events in three tiers: external (real traction), first-party and sandbox (never counted). Read-only.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    run: async () => {
      await indexerTick({ maxWindows: 2, minIntervalSec: 20 }).catch(() => null);
      return (await stats()) as unknown as Json;
    },
  },
  {
    name: "run_demo_scene",
    title: "Run a /try scene on the sandbox org",
    description:
      "Walk through SendSure on its SANDBOX demo org (testnet, never counted as traction). Scenes, in order: bind, attack, change, pay. DRY RUN by default: set dry_run to false to send real Arc testnet transactions. Idempotent: the same idempotency_key always refers to the same demo session, and a scene already run returns its saved result with replayed: true.",
    inputSchema: {
      type: "object",
      properties: {
        scene: { type: "string", enum: ["bind", "attack", "change", "pay"] },
        idempotency_key: { type: "string", description: "Any string; reuse it for all scenes of one walkthrough." },
        dry_run: { type: "boolean", default: true },
      },
      required: ["scene", "idempotency_key"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    run: async (a) => {
      const scene = String(a.scene) as Scene;
      if (!(scene in SCENE_PLANS)) throw new RelayError(400, "scene must be bind, attack, change or pay.", "BAD_INPUT");
      const key = String(a.idempotency_key ?? "").slice(0, 200);
      if (!key) throw new RelayError(400, "idempotency_key is required.", "BAD_INPUT");
      const session = sessionFor(key);
      const done = (await savedScenes(session))[scene];
      if (done) return { scene, dry_run: false, replayed: true, result: done };
      if (a.dry_run !== false)
        return {
          scene,
          dry_run: true,
          replayed: false,
          would: SCENE_PLANS[scene],
          next: "Call again with dry_run: false to run it.",
        };
      const result = await runScene(session, scene);
      return { scene, dry_run: false, replayed: Boolean((result as Json).replayed), result };
    },
  },
];

const ok = (id: unknown, result: Json) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Handles one JSON-RPC message; returns null for notifications (no response). */
export async function handleMcp(msg: Json): Promise<Json | null> {
  const id = msg.id;
  const method = String(msg.method ?? "");
  const params = (msg.params ?? {}) as Json;
  if (id === undefined || id === null) return null; // notifications (e.g. notifications/initialized)
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sendsure", title: "SendSure", version: "0.1.0" },
        instructions:
          "SendSure pays only payees who proved their own address, for claims they signed, inside an on-chain budget (Arc testnet). Use check_payout_list before sending any stablecoin payout. run_demo_scene only touches the sandbox demo org and is a dry run unless dry_run is false.",
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        const out = await tool.run((params.arguments ?? {}) as Json);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          structuredContent: out,
          isError: false,
        });
      } catch (err) {
        const text =
          err instanceof RelayError ? err.message : `Error: ${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
        return ok(id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
