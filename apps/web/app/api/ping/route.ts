import { limitIp, respond } from "../../../lib/http";
import { countEvent } from "../../../lib/notify";

export const dynamic = "force-dynamic";

/** Anonymous usage count: { event }. Only the event name and the day are stored. */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "ping", 60);
    return countEvent(await req.json().catch(() => null));
  });
}
