import { encodeAbiParameters, hashTypedData, keccak256, toBytes, type Address, type Hex } from "viem";
import { claimTypes, mandateDomain } from "./typed";

export interface Claim {
  payeeRef: Hex;
  token: Address;
  amount: bigint;
  refHash: Hex;
  periodStart: bigint;
  periodEnd: bigint;
  nonce: bigint;
  validUntil: bigint;
}

const claimTuple = [
  {
    type: "tuple",
    components: [
      { name: "payeeRef", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "refHash", type: "bytes32" },
      { name: "periodStart", type: "uint64" },
      { name: "periodEnd", type: "uint64" },
      { name: "nonce", type: "uint256" },
      { name: "validUntil", type: "uint64" },
    ],
  },
] as const;

/** The `bytes claim` argument of settle(), check(), cosign() and submitClaim(): abi.encode(Claim). */
export const encodeClaim = (c: Claim): Hex => encodeAbiParameters(claimTuple, [c]);

/** claimId = the EIP-712 digest the payee signs (also the key an approver co-signs). */
export const claimIdOf = (org: Address, c: Claim): Hex =>
  hashTypedData({ domain: mandateDomain(org), types: claimTypes, primaryType: "Claim", message: c });

/** keccak256 of a UTF-8 string, like `cast keccak "…"`. */
export const keccakText = (text: string): Hex => keccak256(toBytes(text));

/** payeeRef = keccak256(abi.encode(payer salt, vendor id)). Unguessable; doubles as the invite secret. */
export const payeeRefOf = (salt: Hex, vendorId: string): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [salt, vendorId]));

/** "inv  001 " and "INV 001" are the same invoice: trim, collapse spaces, upper-case. */
export const normalizeInvoiceRef = (invoiceRef: string): string =>
  invoiceRef.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();

/** refHash = keccak256(abi.encode(payer salt, normalized invoice reference)). Never includes the amount. */
export const refHashOf = (salt: Hex, invoiceRef: string): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "string" }], [salt, normalizeInvoiceRef(invoiceRef)]));
