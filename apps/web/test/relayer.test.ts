import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ZERO_BYTES32, bindTypedData, randomBytes32, type BindMessage } from "@sendsure/chain";
import { RelayError, allow, parseBind, relayBind } from "../lib/relayer";

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
