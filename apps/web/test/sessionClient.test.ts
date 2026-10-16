import { afterEach, describe, expect, it, vi } from "vitest";

// A passkey shows one prompt at a time: count the signatures asked for, and make each one slow like a real prompt.
const signText = vi.fn(async () => {
  await new Promise((r) => setTimeout(r, 20));
  return "0xsig";
});
vi.mock("../lib/wallet", () => ({ signText }));

const { sessionToken } = await import("../lib/sessionClient");

afterEach(() => {
  vi.unstubAllGlobals();
  signText.mockClear();
});

describe("sessionToken", () => {
  it("asks a wallet for one sign-in when a page loads two lists at once", async () => {
    let issued = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ token: `t${++issued}`, expiresAt: Date.now() / 1000 + 86_400 }))),
    );
    const s = { kind: "passkey", address: "0x7C6dFC433a9aBC0b39f4d68dA173feA41DF681Ba" } as never;
    const [a, b] = await Promise.all([sessionToken(s), sessionToken(s)]);
    expect(signText).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("signs in again after a failed attempt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no" }), { status: 401 })));
    const s = { kind: "passkey", address: "0x3460E7c7aA9439db630eAf9468653920e9900Dad" } as never;
    await expect(sessionToken(s)).rejects.toThrow(/no/);
    await expect(sessionToken(s)).rejects.toThrow(/no/);
    expect(signText).toHaveBeenCalledTimes(2);
  });
});
