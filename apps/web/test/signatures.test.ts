import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setDb } from "../lib/db";
import { sqliteDb } from "../lib/dbLocal";
import { claimSignature, releaseSignature, signatureUsed } from "../lib/signatures";

beforeAll(async () => setDb(await sqliteDb(":memory:", path.join(process.cwd(), "migrations"))));

const later = BigInt(Math.floor(Date.now() / 1000) + 900);

describe("used signatures", () => {
  it("a signature can be acted on once, on any instance", async () => {
    expect(await claimSignature("0xAbC1", "invites", later)).toBe(true);
    expect(await claimSignature("0xabc1", "invites", later)).toBe(false); // case does not matter
    expect(await signatureUsed("0xABC1")).toBe(true);
  });
  it("a failed attempt frees it for a retry", async () => {
    expect(await claimSignature("0xdef2", "create-org", later)).toBe(true);
    await releaseSignature("0xdef2");
    expect(await claimSignature("0xdef2", "create-org", later)).toBe(true);
  });
  it("expired ones are cleaned up", async () => {
    expect(await claimSignature("0x0ld3", "invites", 1n)).toBe(true);
    await claimSignature("0xnew4", "invites", later); // any claim sweeps expired rows
    expect(await signatureUsed("0x0ld3")).toBe(false);
  });
});
