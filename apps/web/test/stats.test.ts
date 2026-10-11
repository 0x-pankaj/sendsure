import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setDb } from "../lib/db";
import { sqliteDb } from "../lib/dbLocal";
import { evidence } from "../lib/stats";

const DEPLOYER = "0x38B01c787BFbA932d4601f0f761C950930700809"; // one of our own keys (first-party)
const OUTSIDE = "0x00000000000000000000000000000000000a11ce";
const org = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

describe("the evidence behind the dashboard", () => {
  beforeAll(async () => {
    const db = await sqliteDb(":memory:", path.join(import.meta.dirname, "../migrations"));
    const addOrg = "INSERT INTO chain_orgs (org, owner, treasury, tier, block, tx) VALUES (?, ?, ?, ?, ?, ?)";
    await db.run(addOrg, org(1), OUTSIDE, OUTSIDE, 0, 10, tx(1)); // an outside team
    await db.run(addOrg, org(2), DEPLOYER, DEPLOYER, 0, 11, tx(2)); // our own wallet
    await db.run(addOrg, org(3), OUTSIDE, OUTSIDE, 2, 12, tx(3)); // a sandbox (test) org
    const ev = `INSERT INTO chain_events (tx, log_index, block, address, name, org, payee_ref, claim_id, payout, amount, reason, decision_hash)
      VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`;
    await db.run(ev, tx(10), 20, org(1), "Bound", org(1), tx(100), null, OUTSIDE, null, null);
    await db.run(ev, tx(11), 21, org(1), "Settled", org(1), tx(100), tx(200), OUTSIDE, "1500000", tx(300));
    await db.run(ev, tx(12), 22, org(2), "Settled", org(2), tx(101), tx(201), OUTSIDE, "800000", tx(301));
    await db.run(ev, tx(13), 23, org(3), "Settled", org(3), tx(102), tx(202), OUTSIDE, "200000", tx(302));
    setDb(db);
  });

  it("lists outside teams and our own wallets with their transactions, and only counts our tests", async () => {
    const e = await evidence("https://sendsure.test");
    expect(e.tiers.external.orgs.map((o) => o.org)).toEqual([org(1)]);
    expect(e.tiers.external.payeesBound).toHaveLength(1);
    expect(e.tiers.external.payments).toEqual([
      expect.objectContaining({ amountUsdc: "1.5", tx: tx(11), decisionHash: tx(300), receipt: `https://sendsure.test/receipt?tx=${tx(11)}` }),
    ]);
    expect(e.tiers["first-party"].payments.map((p) => p.amountUsdc)).toEqual(["0.8"]);
    expect(JSON.stringify(e.tiers)).not.toContain(org(3));
    expect(e.totals.sandbox).toMatchObject({ orgs: 1, payments: 1 });
  });
});
