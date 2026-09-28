import { readFileSync } from "node:fs";
import { createPublicClient, hashDomain, http, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPS,
  DEFAULT_CHANGE_COOLDOWN_SECONDS,
  DEFAULT_PERIOD_SECONDS,
  ORG_TIER,
  SENDSURE_AGENTS,
  arcTestnet,
  createOrgMessage,
  deployment,
  formatUsdc,
  initParams,
  inviteBatchHash,
  readMandate,
  usdc,
  usdcDomain,
  usdcPermitAbi,
} from "../src/index";

const smoke = JSON.parse(readFileSync(new URL("../../../deployments/smoke-test.json", import.meta.url), "utf8"));
const client = createPublicClient({ chain: arcTestnet, transport: http() });
const owner = "0x1111111111111111111111111111111111111111" as Address;

describe("org helpers (offline)", () => {
  it("builds createMandate params: USDC only, both SendSure agents, production tier", () => {
    const p = initParams({
      owner,
      treasury: owner,
      approvers: [owner],
      caps: DEFAULT_CAPS,
      periodLength: DEFAULT_PERIOD_SECONDS,
      firstBindCooldown: 0n,
      changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
    });
    expect(p.tokens).toEqual([deployment.usdc]);
    expect(p.agents).toEqual([SENDSURE_AGENTS.circleAgentWallet, SENDSURE_AGENTS.serverAgent]);
    expect(p.tier).toBe(ORG_TIER.PRODUCTION);
  });

  it("USDC amounts use 6 decimals", () => {
    expect(usdc("12.5")).toBe(12_500_000n);
    expect(formatUsdc(1_000_000n)).toBe("1");
  });

  it("the create-org message states the rules in plain words", () => {
    const text = createOrgMessage(
      {
        owner,
        approvers: [owner],
        caps: DEFAULT_CAPS,
        periodLength: DEFAULT_PERIOD_SECONDS,
        changeCooldown: DEFAULT_CHANGE_COOLDOWN_SECONDS,
        sandbox: true,
      },
      1_800_000_000n,
    );
    expect(text.split("\n")[0]).toBe("SendSure: create a TEST payer org (sandbox) on Arc testnet.");
    expect(text).toContain("Budget per 30 days: 100 USDC in total, 50 per payee, 50 per claim.");
    expect(text).toContain("co-signs every payment above 25 USDC");
    expect(text).toContain("Valid until: 2027-01-15T08:00:00.000Z");
  });

  it("an invite batch hash depends on every ref and their order", () => {
    const a = `0x${"aa".repeat(32)}` as const;
    const b = `0x${"bb".repeat(32)}` as const;
    expect(inviteBatchHash([a, b])).not.toBe(inviteBatchHash([b, a]));
    expect(inviteBatchHash([a])).toBe(inviteBatchHash([a]));
  });
});

describe.skipIf(process.env.OFFLINE)("org helpers against Arc testnet", () => {
  it("our USDC permit domain equals the token's DOMAIN_SEPARATOR", async () => {
    const onchain = await client.readContract({
      address: deployment.usdc as Address,
      abi: usdcPermitAbi,
      functionName: "DOMAIN_SEPARATOR",
    });
    expect(
      hashDomain({
        domain: { ...usdcDomain, chainId: BigInt(usdcDomain.chainId) },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
        },
      }),
    ).toBe(onchain);
  });

  it("reads the smoke-test org", async () => {
    const m = await readMandate(client, smoke.org as Address);
    expect(m.tier).toBe(ORG_TIER.SANDBOX);
    expect(m.periodLength).toBe(DEFAULT_PERIOD_SECONDS);
    expect(m.circleAgentAllowed).toBe(true);
    expect(m.caps.orgPeriodCap > 0n).toBe(true);
  });
});
