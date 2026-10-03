import path from "node:path";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { setDb } from "../lib/db";
import { sqliteDb } from "../lib/dbLocal";
import { parseBill, requireKey } from "../lib/integrations";

const ORG = "0x8FA4f5ee6f04D3Bf1A1a5113799508C171DD076C";
const REF = `0x${"ab".repeat(32)}`;
const bill = (over: Record<string, unknown> = {}) => ({
  system: "odoo",
  external_id: "odoo:db1:account.move:42",
  payee_ref: REF,
  invoice_ref: " inv 2026-014 ",
  amount: "250.00",
  currency: "USD",
  invoice_date: "2026-09-25",
  ...over,
});
const req = (key?: string) => new Request("https://x.test/api/v1/org", { headers: key ? { authorization: `Bearer ${key}` } : {} });

describe("bills from a books system", () => {
  it("reads a posted bill exactly, as a decimal string", () => {
    const b = parseBill(bill());
    expect(b.amount).toBe(250_000_000n);
    expect(b.invoiceRef).toBe("INV 2026-014");
    expect(b.currency).toBe("USD");
    expect(new Date(b.periodStart * 1000).toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(b.periodEnd - b.periodStart).toBe(86_399);
  });

  it("refuses amounts that USDC cannot pay exactly, and floats", () => {
    expect(() => parseBill(bill({ amount: "249.9950001" }))).toThrow(/at most 6 decimals/);
    expect(() => parseBill(bill({ amount: 249.995 }))).toThrow(/decimal string/);
    expect(() => parseBill(bill({ amount: "0" }))).toThrow(/above zero/);
    expect(parseBill(bill({ amount: "249.995" })).amount).toBe(249_995_000n);
  });

  it("refuses other currencies, bad ids and missing invoice numbers", () => {
    expect(() => parseBill(bill({ currency: "EUR" }))).toThrow(/USD or USDC/);
    expect(() => parseBill(bill({ external_id: "a b" }))).toThrow(/external_id/);
    expect(() => parseBill(bill({ invoice_ref: "  " }))).toThrow(/invoice_ref/);
    expect(() => parseBill(bill({ payee_ref: "0x12" }))).toThrow(/payee_ref/);
    expect(() => parseBill(bill({ invoice_date: "25/09/2026" }))).toThrow(/YYYY-MM-DD/);
    expect(() => parseBill(bill({ system: "sap" }))).toThrow(/odoo/);
  });
});

describe("integration keys", () => {
  const key = "ssk_test-key-0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
  const revoked = "ssk_revoked-key-0123456789abcdefghijklmnopqrstuvwxyz";
  beforeAll(async () => {
    const db = await sqliteDb(":memory:", path.join(import.meta.dirname, "../migrations"));
    const hash = (k: string) => createHash("sha256").update(k).digest("hex");
    const insert = "INSERT INTO integration_keys (id, org, key_hash, label, created_by, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
    await db.run(insert, "k1", ORG, hash(key), "Odoo", ORG, 1, null);
    await db.run(insert, "k2", ORG, hash(revoked), "Odoo", ORG, 1, 2);
    setDb(db);
  });

  it("a key maps to its org; only its hash is stored", async () => {
    expect(await requireKey(req(key))).toEqual({ org: ORG, keyId: "k1" });
  });

  it("missing, unknown and revoked keys are refused", async () => {
    await expect(requireKey(req())).rejects.toThrow(/Bearer/);
    await expect(requireKey(req("ssk_unknown"))).rejects.toThrow(/not valid/);
    await expect(requireKey(req(revoked))).rejects.toThrow(/not valid/);
    await expect(requireKey(req("sk_live_other"))).rejects.toThrow(/Bearer/);
  });
});

describe("withdrawing a bill the books cancelled", () => {
  it("stops a waiting or signed bill, frees its id, and refuses once it is paid", async () => {
    const { withdrawBill } = await import("../lib/integrations");
    const { getDb } = await import("../lib/db");
    const db = await getDb();
    const now = 1_790_000_000;
    const proposal = (id: string, ext: string, claim: string | null, status: string) =>
      db.run(
        `INSERT INTO proposals (id, org, payee_ref, invoice_ref, amount, period_start, period_end, description, extraction, source, status, claim_id, external_system, external_id, created_at, updated_at)
         VALUES (?, ?, ?, 'INV-1', '250000000', 0, 1, '', '{}', 'odoo', ?, ?, 'odoo', ?, ?, ?)`,
        id, ORG, REF, status, claim, ext, now, now,
      );
    const claim = (id: string, status: string) =>
      db.run(
        `INSERT INTO claims (claim_id, org, payee_ref, payout, token, amount, ref_hash, invoice_ref, period_start, period_end, nonce, valid_until, payee_sig, description, source, status, created_at, updated_at)
         VALUES (?, ?, ?, '0x1', '0x2', '250000000', ?, 'INV-1', 0, 1, '1', 9, '0x', '', 'invoice', ?, ?, ?)`,
        id, ORG, REF, `0x${id.slice(2).padEnd(64, "0")}`, status, now, now,
      );

    await proposal("p1", "odoo:db:account.move:1", null, "proposed");
    expect((await withdrawBill(ORG as never, { external_id: "odoo:db:account.move:1" })).status).toBe("withdrawn");
    expect(await db.first("SELECT id FROM proposals WHERE external_id = 'odoo:db:account.move:1'")).toBeNull();

    await claim("0xc2", "open");
    await proposal("p2", "odoo:db:account.move:2", "0xc2", "claimed");
    await withdrawBill(ORG as never, { external_id: "odoo:db:account.move:2" });
    expect((await db.first<{ status: string }>("SELECT status FROM claims WHERE claim_id = '0xc2'"))?.status).toBe("withdrawn");

    await claim("0xc3", "settled");
    await proposal("p3", "odoo:db:account.move:3", "0xc3", "claimed");
    await expect(withdrawBill(ORG as never, { external_id: "odoo:db:account.move:3" })).rejects.toThrow(/already paid/);
    expect((await db.first<{ status: string }>("SELECT status FROM claims WHERE claim_id = '0xc3'"))?.status).toBe("settled");

    // Unknown (already withdrawn) is fine: cancelling twice must not fail.
    expect((await withdrawBill(ORG as never, { external_id: "odoo:db:account.move:9" })).status).toBe("withdrawn");
  });
});
