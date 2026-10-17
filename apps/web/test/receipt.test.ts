import { describe, expect, it } from "vitest";
import { txHashProblem } from "../lib/receipt";

const TX = "0x6122b62e987efe480740cba5d8ebfafd0e231a95ea8c03cf1770a875459c5bae";

describe("a receipt link's transaction hash", () => {
  it("accepts a whole hash", () => {
    expect(txHashProblem(TX)).toBeNull();
  });

  it("says a link was cut off, and how much of the hash arrived", () => {
    expect(txHashProblem(TX.slice(0, 53))).toBe(
      "This link looks cut off: a transaction hash has 64 characters after 0x, and this one has 51. Copy the whole link and open it again.",
    );
  });

  it("refuses anything else plainly", () => {
    for (const bad of ["", "0x", "hello", `${TX}00`, `${TX.slice(0, 40)}zz`])
      expect(txHashProblem(bad)).toBe("This is not a transaction hash: it should be 0x followed by 64 hex characters.");
  });
});
