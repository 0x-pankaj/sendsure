import { IS_MAINNET, MAINNET_BETA_MAX_CAPS, NETWORK_NAME, formatUsdc } from "@sendsure/chain";

export { IS_MAINNET, NETWORK_NAME };

/** The testnet site, linked from the mainnet beta for anyone who wants to try SendSure with test money. */
export const TESTNET_SITE = "https://sendsure.0xpankaj.workers.dev";
/** The mainnet beta's site (Worker sendsure-mainnet). */
export const MAINNET_SITE = "https://sendsure-mainnet.0xpankaj.workers.dev";
/** This build's own site, for links in messages that leave it (notifications, MCP setup). */
export const SITE = IS_MAINNET ? MAINNET_SITE : TESTNET_SITE;

/** What the mainnet beta leaves out: everything that runs on test money or a Circle testnet service. */
export const FEATURES = {
  /** /try, the sandbox demo and "Try it with a test wallet" (test keys, test USDC). */
  tryIt: !IS_MAINNET,
  /** SendSure's USDC faucet. */
  faucet: !IS_MAINNET,
  /** Passkey wallets: their gas comes from Circle Gas Station, which lists Arc for testnet only. */
  passkey: !IS_MAINNET,
  /** x402 paid checks over Circle Gateway (testnet). */
  x402: !IS_MAINNET,
  /** The Odoo and ERPNext add-ons: their emails and payment links still say testnet, until their next release. */
  erp: !IS_MAINNET,
} as const;

/** What the mainnet beta says where the Odoo and ERPNext add-ons would be. */
export const ERP_NOT_YET =
  "The Odoo and ERPNext add-ons connect to the testnet version for now. They come to the mainnet beta with their next release.";

/** The most one bill can pay on the mainnet beta, e.g. "10". */
export const BETA_MAX_BILL = formatUsdc(MAINNET_BETA_MAX_CAPS.claimMax);

/** One line for the footer. */
export const NETWORK_NOTE = IS_MAINNET
  ? `Arc mainnet beta · real USDC · not audited · at most ${BETA_MAX_BILL} USDC a bill`
  : "Arc testnet only · not audited";

/** For the API route of a testnet-only feature: a 404 on the mainnet beta, null on testnet. */
export function testnetOnly(feature: string): Response | null {
  if (!IS_MAINNET) return null;
  return Response.json({ error: `${feature} is not part of the mainnet beta.`, code: "NOT_ON_MAINNET" }, { status: 404 });
}
