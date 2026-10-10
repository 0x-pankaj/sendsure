// End-to-end on the live site in a real browser: a payee with NO wallet app gets paid through a passkey wallet
// (Circle Modular Wallets on Arc testnet, gas from Circle Gas Station). Chromium's virtual authenticator plays
// the phone's Face ID. Needs NEXT_PUBLIC_CIRCLE_CLIENT_KEY on the deployed site, with its passkey domain set
// to the site's host. First-party test on a SANDBOX org. Not traction.
//   pnpm tsx scripts/e2e-passkey.ts [--base https://sendsure.0xpankaj.workers.dev]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { erc20Abi, getAddress, type Address, type Hex } from "viem";
import { deployment, formatUsdc, readPayee, usdc } from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";
import { client, cosignAsOwner, setupSandboxOrg } from "./lib/flows";
import { api, check, failed, withChecks } from "./lib/relay";
import { privateKeyToAccount } from "viem/accounts";

loadEnv();
const base = arg("base", "https://sendsure.0xpankaj.workers.dev")!;
const USDC = deployment.usdc as Address;
const OUT = resolve(import.meta.dirname, "../deployments/passkey-e2e");
mkdirSync(OUT, { recursive: true });
const s = await setupSandboxOrg(base, "0.3", { bind: false });
check(true, `sandbox org ${s.org} with an open invite and a 10 USDC budget`);

const browser = await chromium.launch();
let account: Address | undefined;
let payment: string | null = null;
try {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const text = (re: RegExp, ms = 180_000) =>
    page.waitForFunction(`new RegExp(${JSON.stringify(re.source)}, "i").test(document.body.innerText)`, undefined, { timeout: ms });

  await page.goto(`${base}/verify?org=${s.org}&ref=${s.payeeRef}&name=${encodeURIComponent("Passkey Test Studio")}`, { waitUntil: "networkidle" });
  const create = page.getByRole("button", { name: "Create a passkey wallet" });
  check((await create.count()) === 1, "a payee with no wallet app is offered a passkey wallet");
  await create.click();
  await text(/Connected:/, 90_000);
  account = getAddress((await page.locator("p", { hasText: "Connected:" }).locator(".mono").innerText()).trim());
  check(true, `passkey wallet created: ${account} (a Circle smart account)`);
  await page.screenshot({ path: `${OUT}/1-created.png` });

  await page.getByRole("button", { name: "Sign and confirm" }).click();
  await text(/Transaction \(success\)/, 180_000);
  const payee = await readPayee(client, s.org, s.payeeRef);
  check(payee.state === "BOUND" && getAddress(payee.payout) === account, `bound on Arc to the passkey wallet, gas paid by Circle Gas Station (${payee.state})`);
  await page.screenshot({ path: `${OUT}/2-bound.png` });

  // A claim, authorised by sending it on Arc from the passkey wallet.
  await page.locator("#inv").fill("INV-PK-1");
  await page.locator("#amt").fill("0.2");
  page.on("response", async (r) => {
    if (r.status() >= 400) console.log("[http]", r.status(), r.url().replace(/\?.*/, ""), (await r.text().catch(() => "")).slice(0, 300));
  });
  await page.getByRole("button", { name: "Sign and send claim" }).click();
  try {
    await text(/co-sign|ESCALATED|Waiting for/, 180_000);
  } catch {
    await page.screenshot({ path: `${OUT}/3-claim-stuck.png` });
    throw new Error(`claim step: ${(await page.locator(".notice").allInnerTexts()).join(" | ").slice(0, 400)}`);
  }
  const claims = await api(base, `/api/claims?org=${s.org}`, { token: s.ownerToken });
  const row = (claims.body.claims as { claim_id: Hex; invoice_ref: string }[]).find((c) => c.invoice_ref === "INV-PK-1");
  check(Boolean(row), `the claim reached SendSure with no signature (sent on Arc by the passkey wallet)`);
  await page.screenshot({ path: `${OUT}/3-claimed.png` });

  // The payer co-signs and the agent pays the passkey wallet.
  await cosignAsOwner(s, row!.claim_id);
  const run = (await api(base, "/api/agent/run", { token: s.ownerToken, body: { org: s.org } })).body as Record<string, any>;
  const d = (run.decisions as any[] | undefined)?.find((x) => x.claimId === row!.claim_id);
  payment = d?.tx?.hash ?? null;
  const held = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  check(d?.tx?.outcome === "Settled" && held === usdc("0.2"), `the agent paid the passkey wallet: ${formatUsdc(held)} USDC (${d?.tx?.outcome})`);

  // The payee moves the money out of the passkey wallet.
  const to = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex).address;
  await page.reload({ waitUntil: "networkidle" });
  await text(/Your passkey wallet/, 60_000);
  await page.locator("#pk-to").fill(to);
  await page.locator("#pk-amount").fill("0.1");
  await page.getByRole("button", { name: "Send USDC" }).click();
  await text(/Sent:/, 180_000);
  const left = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account] });
  check(left === usdc("0.1"), `the payee sent 0.1 USDC out with the passkey; ${formatUsdc(left)} USDC left`);
  await page.screenshot({ path: `${OUT}/4-sent.png` });
} catch (err) {
  check(false, `passkey flow: ${String(err).slice(0, 300)}`);
} finally {
  await browser.close();
}
const out = { note: "Live site, real browser, virtual passkey authenticator; SANDBOX org with throwaway keys. Not traction.", ranAtUnix: Math.floor(Date.now() / 1000), base, org: s.org, passkeyWallet: account ?? null, payment };
writeFileSync(`${OUT}.json`, `${JSON.stringify(withChecks(out), null, 2)}\n`);
console.log(failed() ? `${failed()} check(s) FAILED` : "all checks passed; written deployments/passkey-e2e.json");
process.exit(failed() ? 1 : 0);
