import { describe, expect, it } from "vitest";
import { payeeAccount, toBeancount, usdcAmount } from "../src/index";
import { SAMPLE } from "./fixtures";

describe("beancount export", () => {
  it("writes USDC with exactly six decimals", () => {
    expect(usdcAmount(40_000_000n)).toBe("40.000000");
    expect(usdcAmount(1n)).toBe("0.000001");
    expect(usdcAmount(-300_000n)).toBe("-0.300000");
  });

  it("makes valid account names from payee names", () => {
    expect(payeeAccount("María López & Co.", "abc123")).toBe("Expenses:Contractors:Maria-Lopez-Co");
    expect(payeeAccount("北星", "abc123")).toBe("Expenses:Contractors:Payee-abc123");
  });

  it("reconciles every day to the chain balance with explicit outside movements", () => {
    const text = toBeancount(SAMPLE);
    // Day 1 opens with 0.7 from outside (0.4 closing + 0.3 paid), day 2 adds 100.0 (87.899999 + 12.500001 - 0.4).
    expect(text).toContain("Assets:Arc:Treasury  0.700000 USDC");
    expect(text).toContain("Assets:Arc:Treasury  100.000000 USDC");
    expect(text).toContain("2026-09-29 balance Assets:Arc:Treasury  0.400000 ~ 0.000001 USDC");
    expect(text).toContain("2026-09-30 balance Assets:Arc:Treasury  87.899999 ~ 0.000001 USDC");
    expect(text).toContain('decision-hash: "0xd2"');
  });
});
