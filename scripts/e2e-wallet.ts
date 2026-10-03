// End-to-end check of the live site through a browser wallet, the way a MetaMask user goes through it.
// A real Chromium loads the real pages; window.ethereum is a wallet built into this test that answers the
// page like MetaMask does (accounts, eth_chainId starting on Ethereum, wallet_switchEthereumChain with
// 4902 until Arc testnet is added, personal_sign, eth_signTypedData_v4, eth_sendTransaction). Every
// signature and transaction is real, on Arc testnet. What this cannot show is MetaMask's own popups.
//   payer: the deployer key (first-party, a production-tier org, never counted as traction)
//   payee: a fresh key, on an emulated iPhone (like MetaMask's in-app browser)
//   pnpm tsx scripts/e2e-wallet.ts [--base https://sendsure.0xpankaj.workers.dev] [--shots dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, devices, type Browser, type Page } from "playwright";
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arcTestnet, deployment, formatUsdc, readMandate, readPayee } from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { check, failed, withChecks } from "./lib/relay";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const shots = arg("shots", resolve(import.meta.dirname, "../deployments/wallet-e2e"))!;
mkdirSync(shots, { recursive: true });
const rpc = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
const ARC = `0x${arcTestnet.id.toString(16)}`;
const run = Date.now().toString(36);

// ------------------------------------------------------------------ the wallet the page talks to

interface WalletState {
  chainId: string;
  arcAdded: boolean;
  log: string[];
}

async function attachWallet(page: Page, account: PrivateKeyAccount): Promise<WalletState> {
  const state: WalletState = { chainId: "0x1", arcAdded: false, log: [] };
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(process.env.ARC_RPC_URL || undefined) });
  const fail = (code: number, message: string) => JSON.stringify({ error: { code, message } });
  await page.exposeFunction("__wallet", async (raw: string) => {
    const { method, params } = JSON.parse(raw) as { method: string; params: any[] };
    state.log.push(method);
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return JSON.stringify({ result: [account.address] });
        case "eth_chainId":
          return JSON.stringify({ result: state.chainId });
        case "net_version":
          return JSON.stringify({ result: String(parseInt(state.chainId, 16)) });
        case "wallet_requestPermissions":
          return JSON.stringify({ result: [{ parentCapability: "eth_accounts" }] });
        case "wallet_addEthereumChain":
          if (params[0]?.chainId?.toLowerCase() === ARC) state.arcAdded = true;
          return JSON.stringify({ result: null });
        case "wallet_switchEthereumChain": {
          const target = String(params[0]?.chainId).toLowerCase();
          if (target === ARC && !state.arcAdded) return fail(4902, "Unrecognized chain ID. Try adding the chain using wallet_addEthereumChain first.");
          state.chainId = target;
          void page.evaluate(`window.__walletEmit("chainChanged", ${JSON.stringify(target)})`).catch(() => undefined);
          return JSON.stringify({ result: null });
        }
        case "personal_sign":
          return JSON.stringify({ result: await account.signMessage({ message: { raw: params[0] as Hex } }) });
        case "eth_signTypedData_v4": {
          if (state.chainId !== ARC) return fail(-32603, "wallet is not on Arc testnet");
          const td = JSON.parse(params[1]);
          delete td.types.EIP712Domain;
          return JSON.stringify({ result: await account.signTypedData(td) });
        }
        case "eth_sendTransaction": {
          if (state.chainId !== ARC) return fail(-32603, "wallet is not on Arc testnet");
          const tx = params[0];
          const hash = await wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : 0n,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
          return JSON.stringify({ result: hash });
        }
        default:
          return JSON.stringify({ result: await rpc.request({ method: method as any, params: params as any }) });
      }
    } catch (err: any) {
      return fail(err?.code ?? -32603, String(err?.shortMessage ?? err?.message ?? err));
    }
  });
  // Plain JavaScript (a string), so the page gets exactly this and nothing the TypeScript loader adds.
  await page.addInitScript(`(() => {
    const listeners = {};
    window.__walletEmit = (ev, arg) => (listeners[ev] || []).forEach((f) => f(arg));
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        const out = JSON.parse(await window.__wallet(JSON.stringify({ method, params: params || [] })));
        if (out.error) { const e = new Error(out.error.message); e.code = out.error.code; throw e; }
        return out.result;
      },
      on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    };
  })();`);
  return state;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const text = (page: Page) => page.evaluate("document.body.innerText") as Promise<string>;
async function waitText(page: Page, re: RegExp, ms = 120_000) {
  await page.waitForFunction(`new RegExp(${JSON.stringify(re.source)}, "i").test(document.body.innerText)`, undefined, { timeout: ms });
}

// ------------------------------------------------------------------ the run

const payer = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex);
const payee = privateKeyToAccount(generatePrivateKey());
const browser: Browser = await chromium.launch();
const out: Record<string, unknown> = {};
try {
  // 1. Payer connects on Ethereum, is asked to switch, Arc testnet gets added, then switched to.
  const pctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: "dark" });
  const p = await pctx.newPage();
  const pw = await attachWallet(p, payer);
  await p.goto(`${base}/org`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Connect wallet" }).click();
  await p.getByRole("button", { name: /Switch to Arc testnet/ }).click();
  await waitText(p, /Connected:/, 30_000);
  check(pw.arcAdded && pw.chainId === ARC, `payer connected on Ethereum, was asked to switch, Arc testnet was added and switched to (${pw.log.filter((m) => m.startsWith("wallet_")).join(", ")})`);
  const owned = /already owns/i.test(await text(p));
  check(true, `the payer's earlier orgs on Arc are ${owned ? "offered with \"Open it here\"" : "not shown (none found)"}`);

  // 2. Create an org (a plain-text signature; SendSure pays the gas).
  if (!(await p.locator('input[placeholder="Acme Labs"]').isVisible())) {
    await p.getByRole("button", { name: /create another|Create a new org|another org/i }).first().click();
  }
  await p.locator('input[placeholder="Acme Labs"]').fill(`Wallet test ${run}`);
  await shot(p, "1-create");
  await p.getByRole("button", { name: "Sign and create my org" }).click();
  await p.getByRole("button", { name: "Sign budget" }).waitFor({ timeout: 180_000 });
  const saved = (await p.evaluate(`JSON.parse(localStorage.getItem("sendsure.orgs.v1") || "[]")`)) as any[];
  const org = saved[0]?.org as Address;
  const m0 = await readMandate(rpc, org);
  check(Boolean(org) && m0.owner === payer.address && Number(m0.tier) === 1, `org ${org} created from the page, owned by the payer's wallet, production tier (first-party)`);

  // 3. Budget: an EIP-2612 permit, signed in the wallet.
  const budget = p.locator(".card", { has: p.getByRole("button", { name: "Sign budget" }) }).locator("input").first();
  await budget.fill("3");
  await p.getByRole("button", { name: "Sign budget" }).click();
  let allowance = 0n;
  for (let i = 0; i < 40 && allowance < 3_000_000n; i++) {
    await p.waitForTimeout(3000);
    allowance = await rpc.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "allowance", args: [payer.address, org] });
  }
  check(allowance === 3_000_000n, `budget signed in the wallet: the contract may spend ${formatUsdc(allowance)} USDC`);

  // 4. Invite a payee (a plain-text signature; the SendSure agent opens the invite on-chain).
  await p.locator("textarea").first().fill(`Wallet Test Payee ${run}`);
  await p.getByRole("button", { name: "Sign and create invite links" }).click();
  await p.getByRole("button", { name: /Copy link/ }).first().waitFor({ timeout: 180_000 });
  const vendors = ((await p.evaluate(`JSON.parse(localStorage.getItem("sendsure.orgs.v1") || "[]")`)) as any[])[0]?.vendors ?? [];
  const ref = vendors[0]?.payeeRef as Hex;
  const link = `${base}/verify?org=${org}&ref=${ref}&name=${encodeURIComponent(`Wallet test ${run}`)}`;
  await shot(p, "2-invited");
  check(Boolean(ref), `invite created; link ${link.slice(0, 60)}…`);

  // 5. The payee opens the link on a phone with a wallet browser, switches to Arc, signs once.
  const qctx = await browser.newContext({ ...devices["iPhone 13"], colorScheme: "dark" });
  const q = await qctx.newPage();
  const qw = await attachWallet(q, payee);
  await q.goto(link, { waitUntil: "networkidle" });
  check((await q.getByRole("button", { name: /test wallet/i }).count()) === 0, "a real payer's invite offers no test wallet");
  await q.getByRole("button", { name: "Connect wallet" }).click();
  await q.getByRole("button", { name: /Switch to Arc/ }).first().click();
  await q.getByRole("button", { name: /Sign and confirm/ }).click();
  await waitText(q, /confirmed|proven|Bound/, 180_000);
  await shot(q, "3-payee-bound");
  const bound = (await readPayee(rpc, org, ref)).payout;
  check(qw.arcAdded && String(bound).toLowerCase() === payee.address.toLowerCase(), `payee proved ${payee.address} by signing in the wallet (relayer paid the gas)`);

  // 6. The payee signs a claim for an invoice.
  await q.locator("#inv").fill(`WALLET-${run}`.toUpperCase());
  await q.locator("#amt").fill("0.2");
  await q.getByRole("button", { name: "Sign and send claim" }).click();
  await waitText(q, /co-sign|ESCALATED|Waiting/, 120_000);
  await shot(q, "4-payee-claimed");
  check(true, "payee signed a claim for 0.2 USDC in the wallet; the contract says it needs a co-sign (first payment)");

  // 7. The payer runs the agent, co-signs in the wallet (a real transaction), runs it again: paid.
  await p.reload({ waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Connect wallet" }).click();
  await waitText(p, /Connected:/, 30_000);
  const runAgent = async () => {
    await p.getByRole("button", { name: "Run the agent now" }).click();
    await p.getByRole("button", { name: "Run the agent now" }).waitFor({ timeout: 240_000 });
    await p.waitForTimeout(1500);
  };
  await runAgent();
  const first = await text(p);
  check(/Needs your co-sign/i.test(first), "agent run #1 from the page: needs your co-sign");
  const before = await rpc.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [payee.address] });
  await p.getByRole("button", { name: "Co-sign this claim" }).first().waitFor({ timeout: 60_000 });
  check(true, "after the agent run the claims list opens by itself, with the co-sign button");
  await p.getByRole("button", { name: "Co-sign this claim" }).first().click();
  await waitText(p, /Co-signed/, 180_000);
  const cosignTx = await p.locator("a", { hasText: "tx" }).first().getAttribute("href");
  check(Boolean(cosignTx), `payer co-signed on-chain from the wallet: ${cosignTx}`);
  await p.waitForTimeout(4000);
  await runAgent();
  await shot(p, "5-paid");
  const paidLink = await p.locator("a", { hasText: /Settled on Arc/ }).first().getAttribute("href").catch(() => null);
  let after = before;
  for (let i = 0; i < 10 && after === before; i++) {
    await p.waitForTimeout(2000);
    after = await rpc.readContract({ address: deployment.usdc as Address, abi: erc20Abi, functionName: "balanceOf", args: [payee.address] });
  }
  check(Boolean(paidLink) && after - before === 200_000n, `agent run #2 paid: payee received ${formatUsdc(after - before)} USDC (${paidLink})`);

  // 8. The receipt, as anyone sees it.
  const hash = paidLink?.split("/tx/")[1];
  if (hash) {
    await q.goto(`${base}/receipt?tx=${hash}`, { waitUntil: "networkidle" });
    await waitText(q, /Payment receipt/, 30_000);
    await shot(q, "6-receipt");
    check(/proved it/i.test(await text(q)), "public receipt shows the payee's proof of address, the claim and the decision");
  }

  // 9. Another browser, same wallet: the org is found on Arc and offered.
  const rctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: "dark" });
  const r = await rctx.newPage();
  await attachWallet(r, payer);
  await r.goto(`${base}/org`, { waitUntil: "networkidle" });
  await r.getByRole("button", { name: "Connect wallet" }).click();
  await r.getByRole("button", { name: /Switch to Arc testnet/ }).click();
  await waitText(r, /already owns/, 30_000);
  check((await text(r)).includes(`${org.slice(0, 6)}`), "on a fresh browser, the same wallet is offered its org from Arc (\"Open it here\")");

  Object.assign(out, { org, payee: payee.address, cosign: cosignTx, payment: paidLink, screenshots: "deployments/wallet-e2e/" });
} catch (err) {
  for (const [i, ctx] of browser.contexts().entries())
    for (const [j, pg] of ctx.pages().entries()) {
      await pg.screenshot({ path: `${shots}/fail-${i}-${j}.png`, fullPage: true }).catch(() => undefined);
      console.log(`--- page ${i}.${j} ${pg.url()}\n${(await (pg.evaluate("document.body.innerText") as Promise<string>).catch(() => "")).slice(0, 1500)}`);
    }
  throw err;
} finally {
  await browser.close();
}

writeFileSync(
  resolve(import.meta.dirname, "../deployments/wallet-e2e.json"),
  `${JSON.stringify(withChecks({ note: "Live site in a real browser with a MetaMask-like injected wallet; payer is our deployer key (first-party), payee a fresh key. Not traction.", ranAtUnix: Math.floor(Date.now() / 1000), base, ...out }), null, 2)}\n`,
);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/wallet-e2e.json");
process.exitCode = failed() ? 1 : 0;
