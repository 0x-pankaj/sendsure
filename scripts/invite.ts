// Opens an invite slot on a SendSure org (Mandate) as its owner and prints the payee's link.
//   pnpm tsx scripts/invite.ts --org 0x... [--name "Acme Labs"] [--base http://localhost:3000]
//                              [--vendor <vendor id> --salt <bytes32>]   (default: a random invite id)
// The owner key comes from OWNER_PRIVATE_KEY, else DEPLOYER_PRIVATE_KEY (the sandbox org's owner).
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, explorerTx, mandateAbi, payeeRefOf, randomBytes32 } from "@sendsure/chain";
import { arg, loadEnv, need } from "./lib/env";

export async function openInvite(opts: { org: Hex; payeeRef: Hex; ownerKey: Hex }) {
  const account = privateKeyToAccount(opts.ownerKey);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http() });
  const client = createPublicClient({ chain: arcTestnet, transport: http() });
  const hash = await wallet.writeContract({
    address: opts.org,
    abi: mandateAbi,
    functionName: "openSlots",
    args: [[opts.payeeRef]],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`openSlots reverted: ${explorerTx(hash)}`);
  return hash;
}

export const inviteLink = (base: string, org: string, payeeRef: string, name?: string) =>
  `${base.replace(/\/$/, "")}/verify?org=${org}&ref=${payeeRef}${name ? `&name=${encodeURIComponent(name)}` : ""}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnv();
  const org = getAddress(arg("org") ?? need("SANDBOX_ORG"));
  const vendor = arg("vendor");
  const salt = arg("salt") as Hex | undefined;
  const payeeRef = vendor && salt ? payeeRefOf(salt, vendor) : randomBytes32();
  const ownerKey = (process.env.OWNER_PRIVATE_KEY ?? need("DEPLOYER_PRIVATE_KEY")) as Hex;
  const hash = await openInvite({ org, payeeRef, ownerKey });
  console.log(`slot opened: ${explorerTx(hash)}`);
  console.log(inviteLink(arg("base", "http://localhost:3000")!, org, payeeRef, arg("name")));
}
