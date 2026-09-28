import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { normalizeInvoiceRef } from "@sendsure/chain";
import { sqliteDb } from "../lib/db";
import { issueToken, readToken, signIn, signInMessage } from "../lib/session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
});

describe("sessions", () => {
  const who = privateKeyToAccount(generatePrivateKey());

  it("a token reads back as its address until it expires", async () => {
    const now = Date.now();
    const { token, expiresAt } = await issueToken(who.address, now);
    expect(await readToken(token, now)).toBe(who.address);
    expect(await readToken(token, expiresAt * 1000 + 1)).toBeNull();
  });

  it("a tampered token is refused", async () => {
    const { token } = await issueToken(who.address);
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const [, mac] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ a: other, e: 9_999_999_999 })).toString("base64url");
    expect(await readToken(`${forgedPayload}.${mac}`)).toBeNull();
  });

  it("sign-in needs the address's own fresh signature", async () => {
    const issuedAt = new Date().toISOString();
    const nonce = "0123456789abcdef";
    const signature = await who.signMessage({ message: signInMessage(who.address, issuedAt, nonce) });
    const out = await signIn({ address: who.address, issuedAt, nonce, signature });
    expect(out.address).toBe(who.address);
    const intruder = privateKeyToAccount(generatePrivateKey());
    await expect(signIn({ address: intruder.address, issuedAt, nonce, signature })).rejects.toThrow(/does not match/);
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const oldSig = await who.signMessage({ message: signInMessage(who.address, old, nonce) });
    await expect(signIn({ address: who.address, issuedAt: old, nonce, signature: oldSig })).rejects.toThrow(/too old/);
  });
});

describe("database", () => {
  it("applies the D1 migrations once and enforces one claim per invoice", async () => {
    const db = await sqliteDb(":memory:", path.join(import.meta.dirname, "../migrations"));
    const row = (id: string) => [id, "0xorg", "0xref", "0xpayout", "0xusdc", "1", "0xhash", "INV-1", 0, 0, "1", 0, "0xsig", "", "payee", "open", 0, 0];
    const insert = `INSERT INTO claims (claim_id, org, payee_ref, payout, token, amount, ref_hash, invoice_ref, period_start, period_end,
      nonce, valid_until, payee_sig, description, source, status, created_at, updated_at) VALUES (${Array(18).fill("?").join(", ")})`;
    expect((await db.run(insert, ...row("0x1"))).changes).toBe(1);
    await expect(db.run(insert, ...row("0x2"))).rejects.toThrow(/UNIQUE/);
    expect(await db.first<{ n: number }>("SELECT count(*) AS n FROM claims")).toEqual({ n: 1 });
  });
});

describe("invoice numbers", () => {
  it("the same invoice written differently is the same invoice", () => {
    expect(normalizeInvoiceRef("  inv  2026-014 ")).toBe("INV 2026-014");
    expect(normalizeInvoiceRef("INV 2026-014")).toBe(normalizeInvoiceRef("inv 2026-014"));
  });
});
