import { describe, expect, it } from "vitest";
import { addressKind, checkPayout, looksAlike, normalizeName, parsePayoutCsv, toCsv, checkedRowsToRecords } from "../src/index";

const ACME = "0x1111aaaa0000000000000000000000000000beef";
const ACME_POISONED = "0x1111bbbb0000000000000000000000000000beef";
const BOB_OLD = "0x2222000000000000000000000000000000002222";
const BOB_NEW = "0x2223000000000000000000000000000000002223";
const CAROL = "0x3333000000000000000000000000000000003333";
const DAN = "0x4444000000000000000000000000000000004444";

const lastMonth = `name,address,amount
Acme Design Ltd.,${ACME},1200
Bob Writer,${BOB_OLD},800
Dan Video,${DAN},500
`;

const thisMonth = `Payee,Wallet Address,Amount (USDC),Invoice
ACME Design Limited,${ACME},1200,INV-10
Bob Writer,${BOB_NEW},800,INV-11
Carol Dev,${CAROL},950,INV-12
Acme Design (new wallet!),${ACME_POISONED},1200,INV-13
Dan Video,${DAN},1500,INV-14
Dan Video,${DAN},1500,INV-14
Eve Ops,${CAROL},300,INV-15
Mallory,0x5555aaaa0000000000000000000000000000AAAA,10,INV-16
`;

describe("parsePayoutCsv", () => {
  it("recognises spreadsheet-style headers", () => {
    const { rows, columns, warnings } = parsePayoutCsv(thisMonth);
    expect(columns).toMatchObject({ payee: "Payee", address: "Wallet Address", reference: "Invoice" });
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ line: 2, payee: "ACME Design Limited", amount: null, reference: "INV-10" });
    expect(warnings.filter((w) => w.startsWith("No amount"))).toHaveLength(1); // "Amount (USDC)" is not a known header
  });

  it("reads a Safe CSV-airdrop file (no name column: the address is the payee key)", () => {
    const { rows } = parsePayoutCsv(
      `token_type,token_address,receiver,amount,id\nerc20,0x3600000000000000000000000000000000000000,${CAROL},25.5,\n`,
    );
    expect(rows[0]).toMatchObject({ payee: CAROL, address: CAROL, amount: 25.5 });
  });
});

describe("helpers", () => {
  it("normalises company names", () => {
    expect(normalizeName("ACME Design Ltd.")).toBe(normalizeName("Acme Design Limited"));
  });
  it("spots look-alike addresses", () => {
    expect(looksAlike(ACME, ACME_POISONED)).toBe(true);
    expect(looksAlike(BOB_OLD, BOB_NEW)).toBe(false);
  });
  it("rejects a mixed-case address with a bad checksum", () => {
    expect(addressKind("0x5555aaaa0000000000000000000000000000AAAA")).toBe("invalid");
    expect(addressKind("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")).toBe("other"); // Solana
  });
});

describe("checkPayout", () => {
  const last = parsePayoutCsv(lastMonth).rows;
  const current = parsePayoutCsv(thisMonth.replace("Amount (USDC)", "Amount")).rows;
  const { rows, summary } = checkPayout(current, last);
  const row = (line: number) => rows.find((r) => r.line === line)!;

  it("same address as last time: PAY", () => {
    expect(row(2)).toMatchObject({ status: "SAME_AS_LAST_PAID", action: "PAY" });
  });
  it("changed address: REVIEW, and shows the old one", () => {
    expect(row(3)).toMatchObject({ status: "CHANGED", action: "REVIEW" });
    expect(row(3).lastPaidAddress).toBe(BOB_OLD);
  });
  it("new payee: REVIEW", () => {
    expect(row(4)).toMatchObject({ status: "NEW", action: "REVIEW" });
  });
  it("poisoned look-alike of a known address: STOP", () => {
    expect(row(5)).toMatchObject({ status: "LOOKALIKE", action: "STOP" });
    expect(row(5).lookalikeOf?.toLowerCase()).toBe(ACME);
  });
  it("duplicate row and amount jump: REVIEW", () => {
    expect(row(6).flags).toContain("AMOUNT_JUMP");
    expect(row(7).flags).toEqual(expect.arrayContaining(["DUPLICATE_ROW", "AMOUNT_JUMP"]));
    expect(row(7).action).toBe("REVIEW");
  });
  it("one address used by two payees: REVIEW", () => {
    expect(row(8).flags).toContain("ADDRESS_SHARED_WITH_OTHER_PAYEE");
    expect(row(4).flags).toContain("ADDRESS_SHARED_WITH_OTHER_PAYEE");
  });
  it("bad checksum: STOP", () => {
    expect(row(9)).toMatchObject({ status: "INVALID_ADDRESS", action: "STOP" });
  });
  it("summarises by action", () => {
    expect(summary).toMatchObject({ rows: 8, byAction: { PAY: 1, REVIEW: 5, STOP: 2 } });
  });
  it("exports a checked list", () => {
    const csv = toCsv(checkedRowsToRecords(rows));
    expect(csv.split(/\r?\n/)[0]).toBe(
      "payee,address,amount,token,chain,reference,action,status,flags,last_paid_address,lookalike_of,explanation",
    );
  });
});

describe("addresses on other chains", () => {
  it("accepts valid Stellar, bech32 and SS58 addresses and refuses broken ones", async () => {
    const { addressKind } = await import("../src/index");
    // Stellar's documented example account, and the same with one character changed (checksum fails).
    expect(addressKind("GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H")).toBe("other");
    expect(addressKind("GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2A")).toBe("invalid");
    // BIP-173 / BIP-350 test vectors: bech32 and bech32m; then a corrupted one.
    expect(addressKind("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe("other");
    expect(addressKind("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0")).toBe("other");
    expect(addressKind("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5")).toBe("invalid");
    // Polkadot SS58 (base58, 48 characters).
    expect(addressKind("15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5")).toBe("other");
  });
});
