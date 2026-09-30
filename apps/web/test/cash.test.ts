import { describe, expect, it } from "vitest";
import { planCash } from "../lib/cash";

const c = (claimId: string, amount: bigint, periodEnd: number, createdAt = periodEnd) => ({ claimId, amount, periodEnd, createdAt });

describe("cash plan", () => {
  it("pays everything when it fits", () => {
    expect(planCash([c("a", 40n, 1), c("b", 60n, 2)], 100n)).toEqual({ funded: ["a", "b"], deferred: [], shortBy: 0n });
  });

  it("pays the oldest work first and makes the rest wait", () => {
    const plan = planCash([c("new", 60n, 30), c("old", 60n, 10)], 100n);
    expect(plan.funded).toEqual(["old"]);
    expect(plan.deferred).toEqual(["new"]);
    expect(plan.shortBy).toBe(20n);
  });

  it("still pays a smaller later claim when a bigger one does not fit", () => {
    const plan = planCash([c("old-big", 90n, 10), c("mid", 30n, 20), c("late", 50n, 30)], 100n);
    expect(plan.funded).toEqual(["old-big"]);
    expect(planCash([c("old-big", 190n, 10), c("mid", 30n, 20), c("late", 50n, 30)], 100n).funded).toEqual(["mid", "late"]);
  });

  it("pays nothing from an empty treasury", () => {
    expect(planCash([c("a", 1n, 1)], 0n)).toEqual({ funded: [], deferred: ["a"], shortBy: 1n });
  });
});

describe("autopilot: run only when something changed", () => {
  it("a new claim, a co-sign, a changed check or new funds each start a run; nothing else does", async () => {
    const { somethingChanged } = await import("../lib/autopilot");
    const seen = { "0xa": "ESCALATED:NEEDS_COSIGN_NEW_PAYOUT:-", cash: "500000" };
    expect(somethingChanged(seen, { ...seen })).toBe(false);
    expect(somethingChanged(seen, { ...seen, "0xb": "PAYABLE:NONE:-" })).toBe(true);
    expect(somethingChanged(seen, { ...seen, "0xa": "PAYABLE:NONE:cosigned" })).toBe(true);
    expect(somethingChanged(seen, { ...seen, cash: "700000" })).toBe(true);
    // A claim that was paid or closed is simply gone: no run for that.
    expect(somethingChanged(seen, { cash: "500000" })).toBe(false);
    expect(somethingChanged({}, {})).toBe(false);
  });
});
