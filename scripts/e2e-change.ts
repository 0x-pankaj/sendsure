// End-to-end check of a payout change through the HTTP relayer, on Arc testnet.
// First-party test on the SANDBOX org with throwaway keys: never counted as traction.
//   1. a fresh payee A is bound (invite + relayed Bind)
//   2. an attacker who only controls the new address cannot request the change
//   3. the attacker cannot re-bind the used invite either
//   4. A and the new address C both sign: the change is recorded but waits the org's cooldown,
//      and payouts still go to A
//   5. replaying it is refused
//   6. the payer cancels it (as they would if the payee says "that was not me")
//   pnpm tsx scripts/e2e-change.ts [--base http://localhost:3000] [--org 0x...]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  arcTestnet,
  bindTypedData,
  changeTypedData,
  explorerTx,
  mandateAbi,
  randomNonce,
  readPayee,
  readPendingChange,
  type ChangeMessage,
} from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { bindFreshPayee, bindMessage, check, failed, postRelay, soon, withChecks } from "./lib/relay";

loadEnv();
const base = arg("base", "http://localhost:3000")!;
const smoke = (await import("../deployments/smoke-test.json", { with: { type: "json" } })).default as { org: string };
const org = getAddress(arg("org") ?? smoke.org);
const ownerKey = need("DEPLOYER_PRIVATE_KEY") as Hex;
const client = createPublicClient({ chain: arcTestnet, transport: http() });

const { payeeRef, account: a, openTx, bindTx } = await bindFreshPayee(base, org, ownerKey);
console.log(`1. payee A ${a.address} bound: ${explorerTx(bindTx)}`);

const attacker = privateKeyToAccount(generatePrivateKey());
const c = privateKeyToAccount(generatePrivateKey());
const change = (newPayout: Hex): ChangeMessage => ({ org, payeeRef, oldPayout: a.address, newPayout, nonce: randomNonce(), validUntil: soon() });

// 2. The attacker controls only the new address and forges the "old" signature with its own key.
const hijack = change(attacker.address);
const hijackTyped = changeTypedData(hijack);
const r2 = await postRelay(base, "change", {
  ...hijack,
  oldSig: await attacker.signTypedData(hijackTyped),
  newSig: await attacker.signTypedData(hijackTyped),
});
check(r2.status === 400 && r2.body.code === "BadSignature", `attacker's change refused (${r2.status} ${r2.body.error})`);

// 3. Re-binding the already-used invite to the attacker's address.
const rebind = bindMessage(org, payeeRef, attacker.address);
const r3 = await postRelay(base, "bind", { ...rebind, signature: await attacker.signTypedData(bindTypedData(rebind)) });
check(r3.status === 409, `re-binding the used invite refused (${r3.status} ${r3.body.error})`);

// 4. The real change: A (current) and C (new) sign the same ChangePayout.
const real = change(c.address);
const realTyped = changeTypedData(real);
const signed = { ...real, oldSig: await a.signTypedData(realTyped), newSig: await c.signTypedData(realTyped) };
const r4 = await postRelay(base, "change", signed);
check(r4.status === 200 && r4.body.status === "success", `change with both keys recorded (${r4.status} ${r4.body.status ?? r4.body.error})`);
if (r4.body.txHash) console.log(`4. change tx: ${explorerTx(r4.body.txHash)}`);
const p4 = await readPayee(client, org, payeeRef);
const pending = await readPendingChange(client, org, payeeRef);
const waitHours = pending ? Number(pending.effectiveAt - BigInt(Math.floor(Date.now() / 1000))) / 3600 : 0;
check(p4.changePending && p4.payout === a.address, `payouts still go to A while the change waits (${p4.payout})`);
check(pending?.newPayout === c.address && waitHours > 23, `pending: C after ~${waitHours.toFixed(1)} h`);

// 5. Replay of the same signed change.
const r5 = await postRelay(base, "change", signed);
check(r5.status === 409, `replay refused (${r5.status} ${r5.body.code})`);

// 6. The payer cancels it.
const owner = createWalletClient({ account: privateKeyToAccount(ownerKey), chain: arcTestnet, transport: http() });
const cancelTx = await owner.writeContract({ address: org, abi: mandateAbi, functionName: "cancelPayeeChange", args: [payeeRef] });
await client.waitForTransactionReceipt({ hash: cancelTx });
const p6 = await readPayee(client, org, payeeRef);
check(!p6.changePending && p6.payout === a.address, `payer cancelled it; payout stays A (${explorerTx(cancelTx)})`);

const out = {
  note: "First-party end-to-end test on the SANDBOX org with throwaway keys. Not traction.",
  ranAtUnix: Math.floor(Date.now() / 1000),
  relayerBase: base,
  org,
  payeeRef,
  payeeA: a.address,
  newAddressC: c.address,
  attacker: attacker.address,
  checks: {
    attackerChange: `${r2.status} ${r2.body.code}`,
    attackerRebind: `${r3.status} ${r3.body.code}`,
    realChange: `${r4.status} ${r4.body.status}`,
    pendingNewPayout: pending?.newPayout ?? null,
    waitHours: Number(waitHours.toFixed(2)),
    replay: `${r5.status} ${r5.body.code}`,
    cancelledByPayer: !p6.changePending,
  },
  links: {
    openSlot: explorerTx(openTx),
    bind: explorerTx(bindTx),
    change: r4.body.txHash ? explorerTx(r4.body.txHash) : null,
    cancel: explorerTx(cancelTx),
  },
};
writeFileSync(resolve(import.meta.dirname, "../deployments/relay-e2e-change.json"), `${JSON.stringify(withChecks(out), null, 2)}\n`);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/relay-e2e-change.json");
process.exitCode = failed() ? 1 : 0;
