// End-to-end check of the testnet faucet on the live site: a brand-new wallet signs in, gets 2 test USDC once,
// and is refused a second time. Throwaway key; not traction.
//   pnpm tsx scripts/e2e-faucet.ts [--base https://sendsure.0xpankaj.workers.dev]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTx } from "@sendsure/chain";
import { arg, loadEnv } from "./lib/env";
import { client } from "./lib/flows";
import { api, check, failed, signInAs, withChecks } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const wallet = privateKeyToAccount(generatePrivateKey());
const token = await signInAs(base, wallet);

const status = await api(base, "/api/faucet", { token });
check(status.status === 200 && status.body.canAsk === true && status.body.dripped === false, `a new wallet holds ${status.body.balance} USDC and may ask the faucet`);
const unsigned = await api(base, "/api/faucet", { body: {} });
check(unsigned.status === 401, `without signing in, the faucet refuses (${unsigned.status})`);
const first = await api(base, "/api/faucet", { token, body: {} });
const balance = await client.getBalance({ address: wallet.address });
check(first.status === 200 && formatEther(balance) === "2", `one drip: the wallet now holds ${formatEther(balance)} test USDC (${first.body.txHash ? explorerTx(first.body.txHash) : first.body.error})`);
const second = await api(base, "/api/faucet", { token, body: {} });
check(second.status === 409 && /already got/.test(second.body.error ?? ""), `a second drip to the same wallet is refused: ${second.body.error}`);

writeFileSync(
  resolve(import.meta.dirname, "../deployments/faucet-e2e.json"),
  `${JSON.stringify(withChecks({ note: "Testnet faucet on the live site with a throwaway wallet. Not traction.", ranAtUnix: Math.floor(Date.now() / 1000), base, wallet: wallet.address, drip: first.body.txHash ? explorerTx(first.body.txHash) : null }), null, 2)}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/faucet-e2e.json");
process.exitCode = failed() ? 1 : 0;
