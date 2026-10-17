// Browser only. A payee with no wallet app gets one from a passkey (Face ID, fingerprint or the phone's PIN):
// a Circle smart account (Modular Wallets) on Arc testnet, with gas paid by Circle Gas Station.
//
// The contracts already take payees whose account cannot make an ordinary signature: the account binds
// itself with PayeeRegistry.bind() and authorises each claim by sending Mandate.submitClaim() from the
// proven address, so settle() needs no signature for it. The Circle SDK is loaded only when a payee
// chooses this, so nobody else downloads it.
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, zeroHash, type Address, type Hex } from "viem";
import { createBundlerClient, toWebAuthnAccount, type BundlerClient, type SmartAccount } from "viem/account-abstraction";
import { arc, deployment, encodeClaim, mandateAbi, payeeRegistryAbi, type Claim } from "@sendsure/chain";

// A Client Key is public by design (it only works from the domains set for it in Circle's Console).
const CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ?? "";
const CLIENT_URL = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL || "https://modular-sdk.circle.com/v1/rpc/w3s/buidl";
const STORE = "sendsure.passkey.v1";

export interface PasskeySigner {
  kind: "passkey";
  address: Address;
  account: SmartAccount;
  bundler: BundlerClient;
}

export const passkeysAvailable = (): boolean =>
  Boolean(CLIENT_KEY) && typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

async function fromCredential(credential: unknown): Promise<PasskeySigner> {
  const sdk = await import("@circle-fin/modular-wallets-core");
  const transport = sdk.toModularTransport(`${CLIENT_URL}/arcTestnet`, CLIENT_KEY);
  const client = createPublicClient({ chain: arc, transport: transport as never });
  const bundler = createBundlerClient({ chain: arc, transport: transport as never }) as unknown as BundlerClient;
  const account = (await sdk.toCircleSmartAccount({
    client: client as never,
    owner: toWebAuthnAccount({ credential: credential as never }) as never,
  })) as unknown as SmartAccount;
  // The SDK reports the address in lowercase; everything else (sign-in messages, comparisons) uses the checksum form.
  return { kind: "passkey", address: getAddress(account.address), account, bundler };
}

/** `create`: a new passkey and a new wallet. Otherwise the phone offers the passkeys it already has for SendSure. */
export async function passkeyWallet(create: boolean): Promise<PasskeySigner> {
  const sdk = await import("@circle-fin/modular-wallets-core");
  const credential = await sdk.toWebAuthnCredential({
    transport: sdk.toPasskeyTransport(CLIENT_URL, CLIENT_KEY),
    mode: create ? sdk.WebAuthnMode.Register : sdk.WebAuthnMode.Login,
    username: create ? `sendsure-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}` : undefined,
  });
  // Only the passkey's PUBLIC part is kept, to find the wallet again after a reload; the private key never
  // leaves the phone's passkey store.
  try {
    localStorage.setItem(STORE, JSON.stringify(credential));
  } catch {
    // Private mode: the payee signs in with the passkey again next time.
  }
  return fromCredential(credential);
}

/** The passkey wallet used before in this browser, if any (no prompt until it signs). */
export async function savedPasskeyWallet(): Promise<PasskeySigner | null> {
  if (!passkeysAvailable()) return null;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {
    return null;
  }
  return saved ? fromCredential(JSON.parse(saved)).catch(() => null) : null;
}

/** One user operation, gas paid by Circle Gas Station; resolves with the Arc transaction once it succeeded. */
async function send(s: PasskeySigner, calls: { to: Address; data: Hex }[]): Promise<Hex> {
  const hash = await s.bundler.sendUserOperation({ account: s.account, calls, paymaster: true });
  const { success, receipt } = await s.bundler.waitForUserOperationReceipt({ hash, timeout: 120_000 });
  if (!success) throw new Error("The transaction was refused on Arc. Nothing changed.");
  return receipt.transactionHash;
}

/** The payee's account proves itself: bind() sent from the address that will be paid. */
export function bindWithPasskey(s: PasskeySigner, org: Address, payeeRef: Hex): Promise<Hex> {
  return send(s, [
    {
      to: deployment.payeeRegistry as Address,
      data: encodeFunctionData({ abi: payeeRegistryAbi, functionName: "bind", args: [org, payeeRef, zeroHash, 0] }),
    },
  ]);
}

/** Authorises one claim by sending it from the proven address (instead of signing it). */
export function submitClaimWithPasskey(s: PasskeySigner, org: Address, claim: Claim): Promise<Hex> {
  return send(s, [{ to: org, data: encodeFunctionData({ abi: mandateAbi, functionName: "submitClaim", args: [encodeClaim(claim)] }) }]);
}

/** The payee moves their USDC out of the passkey wallet, to an address they choose. */
export function sendUsdcWithPasskey(s: PasskeySigner, to: Address, amount: bigint): Promise<Hex> {
  return send(s, [
    { to: deployment.usdc as Address, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) },
  ]);
}

export function signTextWithPasskey(s: PasskeySigner, message: string): Promise<Hex> {
  return s.account.signMessage({ message });
}
