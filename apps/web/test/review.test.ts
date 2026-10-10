import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setDb } from "../lib/db";
import { sqliteDb } from "../lib/dbLocal";
import { combineReview, reviewFeedback } from "../lib/review";

beforeAll(async () => setDb(await sqliteDb(":memory:", path.join(process.cwd(), "migrations"))));

describe("shadow review of a payout run", () => {
  it("the model can only make a line stricter than the rules", () => {
    expect(combineReview("PAY", "REVIEW")).toBe("REVIEW");
    expect(combineReview("PAY", "STOP")).toBe("STOP");
    expect(combineReview("STOP", "PAY")).toBe("STOP");
    expect(combineReview("REVIEW", "PAY")).toBe("REVIEW");
    expect(combineReview("PAY", undefined)).toBe("PAY");
  });

  it("feedback is counts only, within one run's worth", async () => {
    await expect(reviewFeedback({ agree: 3, disagree: 1 })).resolves.toEqual({ ok: true });
    await expect(reviewFeedback({ agree: 0, disagree: 0 })).rejects.toThrow();
    await expect(reviewFeedback({ agree: 1.5, disagree: 0 })).rejects.toThrow();
    await expect(reviewFeedback({ agree: 500, disagree: 0 })).rejects.toThrow();
    await expect(reviewFeedback({ agree: "3" })).rejects.toThrow();
  });
});
