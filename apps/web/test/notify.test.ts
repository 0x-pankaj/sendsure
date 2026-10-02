import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { setDb } from "../lib/db";
import { sqliteDb } from "../lib/dbLocal";
import { countEvent, saveLead, usageTotals, webhookKind } from "../lib/notify";

beforeAll(async () => setDb(await sqliteDb(":memory:", path.join(process.cwd(), "migrations"))));

describe("webhooks", () => {
  it("accept only Discord and Slack incoming webhooks over https", () => {
    expect(webhookKind("https://discord.com/api/webhooks/123/abc")).toBe("discord");
    expect(webhookKind("https://hooks.slack.com/services/T0/B0/xyz")).toBe("slack");
    expect(webhookKind("http://discord.com/api/webhooks/123/abc")).toBeNull();
    expect(webhookKind("https://discord.com.evil.example/api/webhooks/1/a")).toBeNull();
    expect(webhookKind("https://user:pw@discord.com/api/webhooks/1/a")).toBeNull();
    expect(webhookKind("https://discord.com:8443/api/webhooks/1/a")).toBeNull();
    expect(webhookKind("https://discord.com/channels/1/2")).toBeNull();
    expect(webhookKind("https://169.254.169.254/latest")).toBeNull();
    expect(webhookKind("not a url")).toBeNull();
  });
});

describe("leads", () => {
  it("need a team, a way to reach them and consent", async () => {
    await expect(saveLead({ team: "", contact: "a@b.co", consent: true, source: "check" })).rejects.toThrow(/team/);
    await expect(saveLead({ team: "Acme", contact: "", consent: true, source: "check" })).rejects.toThrow(/reach you/);
    await expect(saveLead({ team: "Acme", contact: "a@b.co", source: "check" })).rejects.toThrow(/Tick the box/);
    await expect(saveLead({ team: "  Acme   Labs ", contact: "@acme", consent: true, payees: 12, source: "check" })).resolves.toEqual({ ok: true });
  });
});

describe("usage counts", () => {
  it("count allowed events only", async () => {
    await countEvent({ event: "check_run" });
    await countEvent({ event: "check_run" });
    await expect(countEvent({ event: "anything else" })).rejects.toThrow(/Unknown event/);
    expect((await usageTotals()).check_run).toBe(2);
  });
});
