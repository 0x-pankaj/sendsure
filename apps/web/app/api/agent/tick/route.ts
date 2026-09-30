import { autopilotTick } from "../../../../lib/autopilot";
import { respond } from "../../../../lib/http";
import { RelayError } from "../../../../lib/relayer";

/** Called every minute by the Worker's cron (worker.ts): run the agent for orgs on autopilot. Needs CRON_SECRET. */
export function POST(req: Request) {
  return respond(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("x-cron-secret") !== secret) throw new RelayError(403, "Not allowed.", "FORBIDDEN");
    return autopilotTick();
  });
}
