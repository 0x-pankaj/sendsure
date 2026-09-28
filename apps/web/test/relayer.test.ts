import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ZERO_BYTES32, bindTypedData, changeTypedData, randomBytes32, type BindMessage } from "@sendsure/chain";
import { BIND, LIMITS, RelayError, allow, parseBind, parseChange, relayBind, relayRoute, verifyChange } from "../lib/relayer";

const now = 1_800_000_000;
const payee = privateKeyToAccount(generatePrivateKey());
const org = "0x8c50103be05877e41fea5b3181c94e8123328e81"; // lower-case on purpose: the relayer checksums it
const body = (over: Record<string, unknown> = {}) => ({
  org,
  payeeRef: randomBytes32(),
  payout: payee.address,
  nonce: "42",
  validUntil: String(now + 1800),
  signature: `0x${"11".repeat(65)}`,
  ...over,
});
const rejects = (b: unknown, text: RegExp) => {
  expect(() => parseBind(b, now)).toThrow(RelayError);
  expect(() => parseBind(b, now)).toThrow(text);
};

describe("parseBind", () => {
  it("accepts a well-formed request and checksums the addresses", () => {
    const { message } = parseBind(body(), now);
    expect(message.org).toBe("0x8C50103bE05877E41Fea5b3181c94E8123328e81");
    expect(message.nonce).toBe(42n);
    expect(message.realAccountCommit).toBe(ZERO_BYTES32);
    expect(message.realProofType).toBe(0);
  });

  it("rejects malformed input", () => {
    rejects(null, /JSON object/);
    rejects(body({ payeeRef: "0x1234" }), /payeeRef/);
    rejects(body({ signature: "0xdead" }), /signature/);
    rejects(body({ org: "0xnope" }), /org is not an address/);
    rejects(body({ nonce: "-1" }), /nonce is out of range/);
    rejects(body({ nonce: (2n ** 256n).toString() }), /nonce is out of range/);
    rejects(body({ nonce: "abc" }), /nonce is not a number/);
  });

  it("rejects expired and far-future signatures", () => {
    rejects(body({ validUntil: String(now) }), /expired/);
    rejects(body({ validUntil: String(now + 2 * 86_400) }), /too far ahead/);
  });
});

describe("relayBind", () => {
  it("refuses a signature from another key before touching the chain", async () => {
    const realNow = Math.floor(Date.now() / 1000);
    const message: BindMessage = parseBind(body({ validUntil: String(realNow + 1800) }), realNow).message;
    const intruder = privateKeyToAccount(generatePrivateKey());
    const signature = await intruder.signTypedData(bindTypedData(message));
    const err = await relayBind({ message, signature }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(400);
    expect((err as RelayError).code).toBe("BadSignature");
  });
});

describe("allow (rate limit)", () => {
  it("allows up to max hits per window, then again after the window", () => {
    const key = `test:${Math.random()}`;
    expect(allow(key, 2, 1000, 0)).toBe(true);
    expect(allow(key, 2, 1000, 10)).toBe(true);
    expect(allow(key, 2, 1000, 20)).toBe(false);
    expect(allow(key, 2, 1000, 1500)).toBe(true);
  });
});

describe("change requests", () => {
  const realNow = () => Math.floor(Date.now() / 1000);
  const oldKey = privateKeyToAccount(generatePrivateKey());
  const newKey = privateKeyToAccount(generatePrivateKey());
  const changeBody = (over: Record<string, unknown> = {}) => ({
    org,
    payeeRef: randomBytes32(),
    oldPayout: oldKey.address,
    newPayout: newKey.address,
    nonce: "7",
    validUntil: String(realNow() + 1800),
    oldSig: `0x${"11".repeat(65)}`,
    newSig: `0x${"11".repeat(65)}`,
    ...over,
  });

  it("rejects a change to the same address", () => {
    expect(() => parseChange(changeBody({ newPayout: oldKey.address }), realNow())).toThrow(/same as the current/);
  });

  it("needs both the current and the new key", async () => {
    const { message } = parseChange(changeBody(), realNow());
    const typed = changeTypedData(message);
    const intruder = privateKeyToAccount(generatePrivateKey());
    const good = { oldSig: await oldKey.signTypedData(typed), newSig: await newKey.signTypedData(typed) };
    await expect(verifyChange({ message, ...good })).resolves.toBeUndefined();
    await expect(verifyChange({ message, ...good, oldSig: await intruder.signTypedData(typed) })).rejects.toThrow(
      /current payout address did not sign/,
    );
    await expect(verifyChange({ message, ...good, newSig: await intruder.signTypedData(typed) })).rejects.toThrow(
      /new payout address did not sign/,
    );
  });
});

describe("relayRoute", () => {
  it("junk requests naming someone else's address do not use up that address's quota", async () => {
    const victim = privateKeyToAccount(generatePrivateKey()).address;
    const junk = () =>
      new Request("http://relay.test/api/relay/bind", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` },
        body: JSON.stringify({ ...body({ payout: victim, validUntil: String(Math.floor(Date.now() / 1000) + 600) }) }),
      });
    for (let i = 0; i < 5; i++) {
      const res = await relayRoute(junk(), BIND);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("BadSignature");
    }
    // The victim still has the full per-address quota.
    for (let i = 0; i < LIMITS.perPayout.max; i++) {
      expect(allow(`payout:${victim}`, LIMITS.perPayout.max, LIMITS.perPayout.windowMs)).toBe(true);
    }
  });
});
