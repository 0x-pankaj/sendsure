import { limitIp, respond } from "../../../../lib/http";
import { createKey, listKeys, revokeKey } from "../../../../lib/integrations";
import { requireSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/** Create an integration key for a books system (owner or approver). Body: { org, label? }. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "keys", 20);
    return createKey(await requireSession(req), await req.json().catch(() => null));
  });
}

/** ?org=0x… The org's integration keys (never the keys themselves). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "keys-list", 120);
    return listKeys(await requireSession(req), new URL(req.url).searchParams.get("org"));
  });
}

/** Revoke a key. Body: { org, id }. */
export function DELETE(req: Request) {
  return respond(async () => {
    limitIp(req, "keys", 20);
    return revokeKey(await requireSession(req), await req.json().catch(() => null));
  });
}
