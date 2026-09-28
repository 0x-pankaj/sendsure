import { limitIp, respond } from "../../../lib/http";
import { indexerTick } from "../../../lib/indexer";
import { stats } from "../../../lib/stats";

export const dynamic = "force-dynamic";

/** Public traction numbers, counted from indexed chain events (indexes lazily, at most every 20 s). */
export function GET(req: Request) {
  return respond(async () => {
    limitIp(req, "stats", 120);
    const cursor = await indexerTick({ maxWindows: 3, minIntervalSec: 20 }).catch((err: unknown) => ({
      error: String(err).slice(0, 200),
    }));
    return { ...(await stats()), indexer: cursor };
  });
}
