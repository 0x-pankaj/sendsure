// End-to-end check of the payee flow through the HTTP relayer, on Arc testnet.
// First-party test on the SANDBOX org with a fresh throwaway key: never counted as traction.
//   1. the org owner opens an invite slot
//   2. a brand-new EOA signs the Bind typed data (exactly what the verify page asks a wallet to sign)
//   3. POST /api/relay/bind: the relayer checks, simulates and submits bindWithSig, paying the gas
//   4. the registry now shows the slot BOUND to that EOA with tier PROVEN
//   5. replaying the same signature is refused, and a signature from another key is refused
//   pnpm tsx scripts/e2e-bind.ts [--base http://localhost:3000] [--org 0x...]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  SIGNATURE_TTL_SECONDS,
  ZERO_BYTES32,
  arcTestnet,
  bindTypedData,
  explorerAddress,
  explorerTx,
  randomBytes32,
  randomNonce,
  readPayee,
  type BindMessage,
} from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { inviteLink, openInvite } from "./invite";

loadEnv();
const base = arg("base", "http://localhost:3000")!;
const smoke = (await import("../deployments/smoke-test.json", { with: { type: "json" } })).default as { org: string };
const org = getAddress(arg("org") ?? smoke.org);
const client = createPublicClient({ chain: arcTestnet, transport: http() });

async function relay(message: BindMessage, signature: Hex) {
  const res = await fetch(`${base}/api/relay/bind`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...message, nonce: message.nonce.toString(), validUntil: message.validUntil.toString(), signature }),
  });
  return { status: res.status, body: (await res.json()) as { txHash?: Hex; status?: string; error?: string; code?: string } };
}

const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) process.exitCode = 1;
};

const payeeRef = randomBytes32();
const openTx = await openInvite({ org, payeeRef, ownerKey: need("DEPLOYER_PRIVATE_KEY") as Hex });
console.log(`1. invite opened: ${explorerTx(openTx)}`);
console.log(`   link: ${inviteLink(base, org, payeeRef, "SendSure sandbox")}`);

const payee = privateKeyToAccount(generatePrivateKey());
const message: BindMessage = {
  org,
  payeeRef,
  payout: payee.address,
  realAccountCommit: ZERO_BYTES32,
  realProofType: 0,
  nonce: randomNonce(),
  validUntil: BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_TTL_SECONDS),
};
const signature = await payee.signTypedData(bindTypedData(message));
console.log(`2. fresh EOA ${payee.address} signed Bind`);

// A signature from another key for the same payout is refused before anything is sent.
const intruder = privateKeyToAccount(generatePrivateKey());
const forged = await relay(message, await intruder.signTypedData(bindTypedData(message)));
check(forged.status === 400 && forged.body.code === "BadSignature", `forged signature refused (${forged.status} ${forged.body.code})`);

const ok = await relay(message, signature);
check(ok.status === 200 && ok.body.status === "success", `relayer submitted bindWithSig (${ok.status} ${ok.body.status ?? ok.body.error})`);
if (ok.body.txHash) console.log(`3. bind tx: ${explorerTx(ok.body.txHash)}`);

const p = await readPayee(client, org, payeeRef);
check(p.state === "BOUND" && p.tier === "PROVEN" && p.payout === payee.address, `registry: ${p.state} ${p.tier} ${p.payout}`);

const replay = await relay(message, signature);
check(replay.status === 409 && replay.body.code === "NonceUsed", `replay refused (${replay.status} ${replay.body.code})`);

const out = {
  note: "First-party end-to-end test on the SANDBOX org with a throwaway key. Not traction.",
  ranAtUnix: Math.floor(Date.now() / 1000),
  relayerBase: base,
  org,
  payeeRef,
  payout: payee.address,
  openSlotTx: openTx,
  bindTx: ok.body.txHash,
  checks: { forgedRefused: forged.body.code, bound: `${p.state}/${p.tier}`, replayRefused: replay.body.code },
  links: { openSlot: explorerTx(openTx), bind: ok.body.txHash ? explorerTx(ok.body.txHash) : null, payout: explorerAddress(payee.address) },
};
writeFileSync(resolve(import.meta.dirname, "../deployments/relay-e2e.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log("4. written deployments/relay-e2e.json");
