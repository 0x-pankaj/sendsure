import { demoOrg, runScene, savedScenes, type Scene } from "../../../lib/demo";
import { limitIp, respond } from "../../../lib/http";
import { RelayError, allow, toObject } from "../../../lib/relayer";

/** { session, scene }: run one /try scene (real transactions on the SANDBOX demo org). */
export function POST(req: Request) {
  return respond(async () => {
    limitIp(req, "try", 12);
    if (!allow("try:day", 400, 24 * 60 * 60_000))
      throw new RelayError(429, "The demo is busy today. Please come back tomorrow.", "RATE_LIMITED");
    const b = toObject(await req.json().catch(() => null));
    return runScene(String(b.session ?? ""), String(b.scene ?? "") as Scene);
  });
}

/** ?session=… The demo org's address, and the scenes this session already ran. */
export function GET(req: Request) {
  return respond(async () => ({ org: demoOrg(), scenes: await savedScenes(new URL(req.url).searchParams.get("session") ?? "") }));
}
