import type { Address } from "viem";
import { arcTestnet } from "./chain";
import { deployment } from "./generated";

/** EIP-712 domains. Both include chainId and verifyingContract, so signatures cannot be replayed elsewhere. */
export const registryDomain = {
  name: "SendSure PayeeRegistry",
  version: "1",
  chainId: arcTestnet.id,
  verifyingContract: deployment.payeeRegistry as Address,
} as const;

export const mandateDomain = (org: Address) =>
  ({ name: "SendSure Mandate", version: "1", chainId: arcTestnet.id, verifyingContract: org }) as const;

export const bindTypes = {
  Bind: [
    { name: "org", type: "address" },
    { name: "payeeRef", type: "bytes32" },
    { name: "payout", type: "address" },
    { name: "realAccountCommit", type: "bytes32" },
    { name: "realProofType", type: "uint8" },
    { name: "nonce", type: "uint256" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export const changeTypes = {
  ChangePayout: [
    { name: "org", type: "address" },
    { name: "payeeRef", type: "bytes32" },
    { name: "oldPayout", type: "address" },
    { name: "newPayout", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

export const claimTypes = {
  Claim: [
    { name: "payeeRef", type: "bytes32" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "refHash", type: "bytes32" },
    { name: "periodStart", type: "uint64" },
    { name: "periodEnd", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;
