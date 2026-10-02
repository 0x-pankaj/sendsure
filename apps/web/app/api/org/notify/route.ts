import { limitIp, respond } from "../../../../lib/http";
import { getNotify, setNotify } from "../../../../lib/notify";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** ?org=0x… Whether the org sends notices to a webhook (the URL is shown masked). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "notify", 120);
    return getNotify(await requireSession(req), new URL(req.url).searchParams.get("org"));
  });
}

/** { org, url } sets the Discord or Slack webhook (after a test message); { org, url: null } removes it. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "notify-set", 20);
    return setNotify(await requireSession(req), await req.json().catch(() => null));
  });
}
