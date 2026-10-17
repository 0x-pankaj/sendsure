import { orgBooks } from "../../../../lib/books";
import { demoOrg } from "../../../../lib/demo";
import { limitIp, respond } from "../../../../lib/http";
import { testnetOnly } from "../../../../lib/network";

export const dynamic = "force-dynamic";

/** The demo org's books (public: it is a sandbox). */
export function GET(req: Request) {
  const off = testnetOnly("The try-it demo");
  if (off) return off;
  return respond(async () => {
    limitIp(req, "try-books", 20);
    return orgBooks(demoOrg());
  });
}
