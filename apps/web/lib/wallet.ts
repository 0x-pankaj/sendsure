import { createWalletClient, custom, type Address, type EIP1193Provider, type Hex, type LocalAccount, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, bindTypedData, type BindMessage } from "@sendsure/chain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/** Who signs: a browser wallet (MetaMask, Rabby, ...) or a throwaway test wallet kept in this tab. */
export type Signer =
  | { kind: "browser"; address: Address; client: WalletClient }
  | { kind: "test"; address: Address; account: LocalAccount };

export const hasBrowserWallet = () => typeof window !== "undefined" && Boolean(window.ethereum);

export async function connectBrowserWallet(): Promise<Signer> {
  if (!window.ethereum) throw new Error("No wallet found in this browser. Install MetaMask or Rabby, or use a test wallet.");
  const client = createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum) });
  const [address] = await client.requestAddresses();
  if (!address) throw new Error("The wallet did not share an address.");
  return { kind: "browser", address, client };
}

const TEST_KEY = "sendsure.testWalletKey";
let memoryKey: Hex | undefined;

/** Testnet only. The key lives in this tab's session storage and is gone when the tab closes. */
export function testWallet(): Signer {
  let key: Hex | undefined;
  try {
    key = (sessionStorage.getItem(TEST_KEY) as Hex | null) ?? undefined;
    if (!key) {
      key = generatePrivateKey();
      sessionStorage.setItem(TEST_KEY, key);
    }
  } catch {
    key = memoryKey ??= generatePrivateKey();
  }
  const account = privateKeyToAccount(key);
  return { kind: "test", address: account.address, account };
}

export async function isOnArc(s: Signer): Promise<boolean> {
  return s.kind === "test" || (await s.client.getChainId()) === arcTestnet.id;
}

/** Switch the wallet to Arc testnet, adding the network first if the wallet does not know it. */
export async function switchToArc(s: Signer): Promise<void> {
  if (s.kind === "test") return;
  try {
    await s.client.switchChain({ id: arcTestnet.id });
  } catch (err) {
    if (codeOf(err) !== 4902 && !/4902|unrecognized chain|not been added|unknown chain/i.test(messageOf(err))) throw err;
    await s.client.addChain({ chain: arcTestnet });
    await s.client.switchChain({ id: arcTestnet.id }).catch(() => undefined);
  }
}

export async function signBind(s: Signer, message: BindMessage): Promise<Hex> {
  const typed = bindTypedData(message);
  return s.kind === "test" ? s.account.signTypedData(typed) : s.client.signTypedData({ account: s.address, ...typed });
}

const codeOf = (err: unknown): number | undefined => {
  const e = err as { code?: number; cause?: { code?: number } } | null;
  return e?.code ?? e?.cause?.code;
};
const messageOf = (err: unknown): string => {
  const e = err as { shortMessage?: string; message?: string } | null;
  return e?.shortMessage ?? e?.message ?? "";
};

/** Wallet and relayer errors in plain words. */
export function walletErrorText(err: unknown): string {
  if (codeOf(err) === 4001 || /user rejected|user denied|rejected the request/i.test(messageOf(err))) {
    return "You cancelled in your wallet. Nothing was signed or sent.";
  }
  return messageOf(err) || "Something went wrong. Please try again.";
}
