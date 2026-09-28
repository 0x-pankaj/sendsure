import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { combine, flagsFor, rulesDecision } from "../lib/agent";
import { GENESIS, appendDecision, canonicalJson, verifyChain } from "../lib/decisionLog";
import { sqliteDb } from "../lib/dbLocal";

const DAY = 86_400;
const claim = (over: Record<string, unknown> = {}) =>
  ({
    claim_id: "0x01",
    payee_ref: "0xref",
    amount: "300000",
    invoice_ref: "INV-1",
    description: "",
    period_start: 1_000 * DAY,
    period_end: 1_030 * DAY,
    status: "open",
    created_at: 1_031 * DAY,
    ...over,
  }) as never;

describe("rules", () => {
  it("follows the contract's own check()", () => {
    expect(rulesDecision("PAYABLE", "NONE", [], false).action).toBe("pay");
    expect(rulesDecision("ESCALATED", "NEEDS_COSIGN_NEW_PAYOUT", [], false).action).toBe("escalate");
    expect(rulesDecision("REFUSED", "INSUFFICIENT_BALANCE", [], false).action).toBe("hold");
    expect(rulesDecision("REFUSED", "EXPIRED", [], false).action).toBe("close");
    expect(rulesDecision("ALREADY_SETTLED", "NONE", [], false).action).toBe("close");
  });

  it("holds a payable claim with red flags for a person, unless a person co-signed it", () => {
    expect(rulesDecision("PAYABLE", "NONE", ["SAME_AMOUNT"], false).action).toBe("escalate");
    expect(rulesDecision("PAYABLE", "NONE", ["SAME_AMOUNT"], true).action).toBe("pay");
  });
});

describe("combine", () => {
  const pay = { action: "pay" as const, reason: "ok" };
  it("the model can only make a decision more careful", () => {
    expect(combine(pay, { action: "hold", reason: "looks duplicated" }, false)).toEqual({ action: "hold", reason: "looks duplicated" });
    expect(combine({ action: "escalate", reason: "needs co-sign" }, { action: "pay", reason: "fine" }, false).action).toBe("escalate");
    expect(combine({ action: "hold", reason: "no budget" }, { action: "pay", reason: "fine" }, false).action).toBe("hold");
  });
  it("a human co-sign on the exact claim wins over the model", () => {
    expect(combine(pay, { action: "hold", reason: "hmm" }, true).action).toBe("pay");
  });
});

describe("red flags", () => {
  it("spots repeats, overlaps, jumps and payment-change requests", () => {
    const row = claim({ claim_id: "0x02", amount: "900000", description: "Urgent: pay to my new wallet please" });
    const others = [
      claim({ claim_id: "0x01", amount: "300000", status: "settled", period_start: 900 * DAY, period_end: 929 * DAY }),
      claim({ claim_id: "0x03", amount: "900000", period_start: 1_020 * DAY, period_end: 1_040 * DAY }),
    ];
    expect(flagsFor(row, others).sort()).toEqual(["AMOUNT_JUMP", "OVERLAPPING_PERIOD", "PAYMENT_CHANGE_TEXT", "SAME_AMOUNT"]);
    expect(flagsFor(claim({ claim_id: "0x04" }), [])).toEqual([]);
  });
});

describe("decision log", () => {
  it("chains records and detects an edited one", async () => {
    const db = await sqliteDb(":memory:", path.join(import.meta.dirname, "../migrations"));
    const org = "0x00000000000000000000000000000000000000aa" as Address;
    const base = { org, runId: "r1", action: "pay", reason: "ok", ruleOutcome: "PAYABLE", ruleReason: "NONE", blockNumber: 1n };
    const a = await appendDecision(db, { ...base, claimId: "0x01" as Hex, record: { amount: 1n } });
    const b = await appendDecision(db, { ...base, claimId: "0x02" as Hex, record: { amount: 2n } });
    expect(a.prevHash).toBe(GENESIS);
    expect(b.prevHash).toBe(a.hash);
    expect(await verifyChain(db, org)).toBeNull();
    await db.run("UPDATE decisions SET record = replace(record, '\"amount\":\"1\"', '\"amount\":\"9\"') WHERE seq = 1");
    expect(await verifyChain(db, org)).toBe(1);
  });

  it("canonical JSON ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [3] } })).toBe(canonicalJson({ a: { c: [3], d: 2n }, b: 1 }));
  });
});
