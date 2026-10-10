import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { dripRefusal } from "../lib/faucet";

const ok = { balance: 0n, alreadyDripped: false, networkToday: 0, globalTodayUsdc: 0 };

describe("testnet faucet", () => {
  it("drips to a new, empty wallet", () => {
    expect(dripRefusal(ok)).toBeNull();
    expect(dripRefusal({ ...ok, balance: parseEther("0.99") })).toBeNull();
  });
  it("refuses a wallet that already got some, holds enough, or a busy network, or when the day's budget is spent", () => {
    expect(dripRefusal({ ...ok, alreadyDripped: true })).toMatch(/already got/);
    expect(dripRefusal({ ...ok, balance: parseEther("1") })).toMatch(/already holds 1 test USDC/);
    expect(dripRefusal({ ...ok, networkToday: 3 })).toMatch(/several times today/);
    expect(dripRefusal({ ...ok, globalTodayUsdc: 59 })).toMatch(/empty for today/);
  });
});
