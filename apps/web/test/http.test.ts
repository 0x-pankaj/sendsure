import { describe, expect, it } from "vitest";
import { arc } from "@sendsure/chain";
import { respond } from "../lib/http";
import { RelayError } from "../lib/relayer";

describe("API answers", () => {
  it("name the chain, so a books system knows whether it moves test or real USDC", async () => {
    const ok = await respond(async () => ({ fine: true }));
    expect(ok.headers.get("x-sendsure-chain")).toBe(String(arc.id));
    expect(await ok.json()).toEqual({ fine: true });
    const refused = await respond(async () => {
      throw new RelayError(400, "No.", "BAD_INPUT");
    });
    expect(refused.status).toBe(400);
    expect(refused.headers.get("x-sendsure-chain")).toBe(String(arc.id));
    expect(await refused.json()).toEqual({ error: "No.", code: "BAD_INPUT" });
  });
});
