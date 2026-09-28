import type { Address } from "viem";

/** The text a wallet signs to sign in (shared by the browser and the server). */
export function signInMessage(address: Address, issuedAt: string, nonce: string): string {
  return [
    "SendSure: sign in",
    `Address: ${address}`,
    `Issued: ${issuedAt}`,
    `Nonce: ${nonce}`,
    "Signing in does not move money or give anyone access to your wallet.",
  ].join("\n");
}
