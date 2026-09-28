import { readFileSync } from "node:fs";
import { createPublicClient, encodeAbiParameters, hashTypedData, http, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  OUTCOMES,
  PAYEE_STATES,
  PAYEE_TIERS,
  REASONS,
  ZERO_BYTES32,
  arcTestnet,
  bindTypedData,
  bindTypes,
  claimIdOf,
  deployment,
  encodeClaim,
  keccakText,
  mandateAbi,
  payeeRefOf,
  formatDuration,
  payeeRegistryAbi,
  randomNonce,
  readOrg,
  readPayee,
  refHashOf,
  registryDomain,
  type Claim,
} from "../src/index";

const smoke = JSON.parse(readFileSync(new URL("../../../deployments/smoke-test.json", import.meta.url), "utf8"));
const client = createPublicClient({ chain: arcTestnet, transport: http() });
const org = smoke.org as Address;
const now = BigInt(smoke.ranAtUnix);
const salt = keccakText("sendsure-smoke-salt");
const smokeClaim: Claim = {
  payeeRef: payeeRefOf(salt, "smoke-payee"),
  token: deployment.usdc as Address,
  amount: 1_000_000n,
  refHash: refHashOf(salt, "INV-SMOKE-1"),
  periodStart: now - 86_400n,
  periodEnd: now,
  nonce: 1n,
  validUntil: now + 604_800n,
};

describe("offline helpers", () => {
  it("mirrors the Solidity enums", () => {
    expect(OUTCOMES).toHaveLength(4);
    expect(REASONS).toHaveLength(24);
    expect(REASONS[22]).toBe("NEEDS_COSIGN_NEW_PAYOUT");
  });

  it("encodes a claim as abi.encode(Claim): 8 static words", () => {
    expect((encodeClaim(smokeClaim).length - 2) / 64).toBe(8);
  });

  it("mirrors the registry enums", () => {
    expect(PAYEE_STATES).toEqual(["NONE", "OPEN", "BOUND", "FROZEN", "REVOKED"]);
    expect(PAYEE_TIERS).toEqual(["NONE", "PROVEN", "ATTESTED"]);
  });

  it("random nonces are 256-bit and distinct", () => {
    const a = randomNonce();
    const b = randomNonce();
    expect(a).not.toBe(b);
    expect(a < 2n ** 256n).toBe(true);
  });

  it("formats cooldowns in plain words", () => {
    expect(formatDuration(0)).toBe("no wait");
    expect(formatDuration(86_400n)).toBe("1 day");
    expect(formatDuration(2 * 86_400)).toBe("2 days");
    expect(formatDuration(7_200)).toBe("2 hours");
    expect(formatDuration(600)).toBe("10 minutes");
  });
});

describe.skipIf(process.env.OFFLINE)("matches the contracts live on Arc testnet", () => {
  it("claimId computed in TypeScript equals Mandate.claimIdOf on-chain", async () => {
    const onchain = await client.readContract({ address: org, abi: mandateAbi, functionName: "claimIdOf", args: [smokeClaim] });
    expect(claimIdOf(org, smokeClaim)).toBe(onchain);
  });

  it("obligationId equals Mandate.obligationIdOf on-chain", async () => {
    const local = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [org, smokeClaim.payeeRef, smokeClaim.refHash]),
    );
    const onchain = await client.readContract({
      address: org,
      abi: mandateAbi,
      functionName: "obligationIdOf",
      args: [smokeClaim.payeeRef, smokeClaim.refHash],
    });
    expect(local).toBe(onchain);
  });

  it("the Settled event of the smoke test carries the same claimId and payeeRef", async () => {
    const settle = smoke.steps.find((s: { step: string }) => s.step === "agent wallet settle #2");
    const receipt = await client.getTransactionReceipt({ hash: settle.tx as Hex });
    const settled = receipt.logs.find((l) => l.address.toLowerCase() === org.toLowerCase() && l.topics.length === 4);
    expect(settled?.topics[2]).toBe(claimIdOf(org, smokeClaim));
    expect(settled?.topics[3]).toBe(smokeClaim.payeeRef);
  });

  it("Bind digest computed in TypeScript equals PayeeRegistry.bindDigest on-chain", async () => {
    const message = {
      org,
      payeeRef: smokeClaim.payeeRef,
      payout: smoke.payee as Address,
      realAccountCommit: ZERO_BYTES32,
      realProofType: 0,
      nonce: 77n,
      validUntil: 2_000_000_000n,
    };
    const local = hashTypedData({ domain: registryDomain, types: bindTypes, primaryType: "Bind", message });
    expect(hashTypedData(bindTypedData(message))).toBe(local);
    const onchain = await client.readContract({
      address: deployment.payeeRegistry as Address,
      abi: payeeRegistryAbi,
      functionName: "bindDigest",
      args: [message.org, message.payeeRef, message.payout, message.realAccountCommit, message.realProofType, message.nonce, message.validUntil],
    });
    expect(local).toBe(onchain);
  });

  it("reads the smoke-test payee as BOUND and PROVEN, and the org's cooldowns", async () => {
    const p = await readPayee(client, org, smokeClaim.payeeRef);
    expect(p.state).toBe("BOUND");
    expect(p.tier).toBe("PROVEN");
    expect(p.payout.toLowerCase()).toBe(String(smoke.payee).toLowerCase());
    const o = await readOrg(client, org);
    expect(o.registered).toBe(true);
    expect(o.changeCooldown).toBe(86_400n);
  });
});
