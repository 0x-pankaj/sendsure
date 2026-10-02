// Server only. Messages to the people who run an org, and to the SendSure team, by webhook.
//
// An org's owner or approver can give SendSure a Discord or Slack incoming-webhook URL. SendSure then
// posts there when a payee signs a claim, when a claim waits for a person's co-sign, and when the agent
// pays. Only those two hosts are accepted, over https, so the URL cannot be used to reach anything else.
// Messages never carry payee names (SendSure does not have them): invoice number, amount, and a link.
import type { Address } from "viem";
import { isOwnerOrApprover } from "./claims";
import { getDb } from "./db";
import { RelayError, toAddress, toObject } from "./relayer";

const SITE = process.env.PUBLIC_BASE_URL || "https://sendsure.0xpankaj.workers.dev";
const HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com", "hooks.slack.com"]);

/** A Discord or Slack incoming webhook, or null. */
export function webhookKind(raw: string): "discord" | "slack" | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !HOSTS.has(u.hostname)) return null;
  if (u.hostname === "hooks.slack.com") return u.pathname.startsWith("/services/") ? "slack" : null;
  return u.pathname.startsWith("/api/webhooks/") ? "discord" : null;
}

/** Posts one plain-text message. Never throws: a broken webhook must not break a payment. */
export async function postWebhook(url: string, text: string): Promise<string | null> {
  const kind = webhookKind(url);
  if (!kind) return "not a Discord or Slack webhook";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kind === "slack" ? { text } : { content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? null : `the webhook answered ${res.status}`;
  } catch (err) {
    return String((err as Error).message ?? err).slice(0, 200);
  }
}

/** Runs `p` after the response when the Worker allows it, so a slow webhook never delays the user. */
export async function inBackground(p: Promise<unknown>): Promise<void> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { ctx } = await getCloudflareContext({ async: true });
    if (ctx?.waitUntil) {
      ctx.waitUntil(p.catch(() => undefined));
      return;
    }
  } catch {
    // plain Node (tests, local dev): just wait for it
  }
  await p.catch(() => undefined);
}

/** Tells an org's people something happened, if they set a webhook. */
export async function notifyOrg(org: Address, text: string): Promise<void> {
  const db = await getDb();
  const row = await db.first<{ webhook_url: string }>("SELECT webhook_url FROM org_notify WHERE lower(org) = lower(?)", org);
  if (!row) return;
  const error = await postWebhook(row.webhook_url, `${text}\n${SITE}/org`);
  await db.run("UPDATE org_notify SET last_error = ? WHERE lower(org) = lower(?)", error, org);
}

/** Tells the SendSure team (LEADS_WEBHOOK_URL), if set. */
export async function notifyTeam(text: string): Promise<void> {
  const url = process.env.LEADS_WEBHOOK_URL;
  if (url) await postWebhook(url, text);
}

const mask = (url: string) => url.replace(/\/[^/]{6,}$/, "/••••••");

export async function getNotify(session: Address, orgParam: string | null) {
  const org = toAddress(orgParam, "org");
  if (!(await isOwnerOrApprover(org, session)))
    throw new RelayError(403, "Only the org's owner or an approver can see where it sends notices.", "FORBIDDEN");
  const db = await getDb();
  const row = await db.first<{ webhook_url: string; set_at: number; last_error: string | null }>(
    "SELECT webhook_url, set_at, last_error FROM org_notify WHERE lower(org) = lower(?)",
    org,
  );
  return row
    ? { set: true, kind: webhookKind(row.webhook_url), url: mask(row.webhook_url), setAt: row.set_at, lastError: row.last_error }
    : { set: false };
}

/** Body: { org, url } to set (a test message is sent first), { org, url: null } to remove. */
export async function setNotify(session: Address, body: unknown) {
  const b = toObject(body);
  const org = toAddress(b.org, "org");
  if (!(await isOwnerOrApprover(org, session)))
    throw new RelayError(403, "Only the org's owner or an approver can change where it sends notices.", "FORBIDDEN");
  const db = await getDb();
  if (b.url === null || b.url === "") {
    await db.run("DELETE FROM org_notify WHERE lower(org) = lower(?)", org);
    return { set: false };
  }
  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (url.length > 300 || !webhookKind(url))
    throw new RelayError(400, "Paste a Discord or Slack incoming-webhook URL (https://discord.com/api/webhooks/… or https://hooks.slack.com/services/…).", "BAD_INPUT");
  const error = await postWebhook(url, "SendSure is connected. You'll get a message here when a payee signs a claim, when a payment waits for your co-sign, and when the agent pays.");
  if (error) throw new RelayError(400, `The test message did not go through (${error}). Check the URL and try again.`, "WEBHOOK_FAILED");
  await db.run(
    `INSERT INTO org_notify (org, webhook_url, set_by, set_at, last_error) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(org) DO UPDATE SET webhook_url = excluded.webhook_url, set_by = excluded.set_by, set_at = excluded.set_at, last_error = NULL`,
    org,
    url,
    session,
    Math.floor(Date.now() / 1000),
  );
  return getNotify(session, org);
}

// ------------------------------------------------------------------ leads

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** "Get set up": a team leaves a way to reach them. They type it in themselves and tick consent. */
export async function saveLead(body: unknown) {
  const b = toObject(body);
  const team = clip(b.team, 80);
  const contact = clip(b.contact, 120);
  if (!team) throw new RelayError(400, "Tell us your team or company name.", "BAD_INPUT");
  if (contact.length < 3) throw new RelayError(400, "Leave an email, a Telegram handle or a link so we can reach you.", "BAD_INPUT");
  if (b.consent !== true) throw new RelayError(400, "Tick the box so we may contact you about SendSure.", "BAD_INPUT");
  const payees = Number.isInteger(b.payees) && (b.payees as number) >= 0 && (b.payees as number) < 100_000 ? (b.payees as number) : null;
  const lead = {
    id: crypto.randomUUID(),
    team,
    contact,
    pays_in: clip(b.paysIn, 80),
    payees,
    next_payout: clip(b.nextPayout, 40),
    note: clip(b.note, 500),
    source: clip(b.source, 30) || "site",
  };
  const db = await getDb();
  await db.run(
    "INSERT INTO leads (id, team, contact, pays_in, payees, next_payout, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    lead.id,
    lead.team,
    lead.contact,
    lead.pays_in,
    lead.payees,
    lead.next_payout,
    lead.note,
    lead.source,
    Math.floor(Date.now() / 1000),
  );
  await inBackground(
    notifyTeam(
      `New SendSure lead (${lead.source}): ${lead.team} · ${lead.contact}` +
        (lead.pays_in ? ` · pays in ${lead.pays_in}` : "") +
        (lead.payees !== null ? ` · ${lead.payees} payees` : "") +
        (lead.next_payout ? ` · next payout ${lead.next_payout}` : "") +
        (lead.note ? `\n${lead.note}` : ""),
    ),
  );
  return { ok: true };
}

// ------------------------------------------------------------------ anonymous usage counts

const EVENTS = new Set(["check_run", "invite_open", "try_start", "books_download"]);

/** Adds one to today's count for an allowed event. Nothing else is stored. */
export async function countEvent(body: unknown) {
  const event = clip(toObject(body).event, 30);
  if (!EVENTS.has(event)) throw new RelayError(400, "Unknown event.", "BAD_INPUT");
  const db = await getDb();
  await db.run(
    "INSERT INTO usage_counts (day, event, n) VALUES (?, ?, 1) ON CONFLICT(day, event) DO UPDATE SET n = n + 1",
    new Date().toISOString().slice(0, 10),
    event,
  );
  return { ok: true };
}

export async function usageTotals(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.all<{ event: string; n: number }>("SELECT event, SUM(n) AS n FROM usage_counts GROUP BY event");
  return Object.fromEntries(rows.map((r) => [r.event, Number(r.n)]));
}
