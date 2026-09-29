// @ts-nocheck: bundled by wrangler around the OpenNext build output (generated at build time).
// The Next.js app handles every request; a cron trigger keeps the chain index fresh every minute,
// so receipts, lookups and the dashboard never wait for someone to open a page first.
import { default as handler } from "./.open-next/worker.js";

export default {
  fetch: handler.fetch,
  async scheduled(_controller, env, ctx) {
    const tick = new Request("https://sendsure.internal/api/indexer/tick", {
      method: "POST",
      headers: { "x-cron-secret": env.CRON_SECRET ?? "" },
    });
    ctx.waitUntil(handler.fetch(tick, env, ctx));
  },
};

// OpenNext's optional Durable Objects (unused here, re-exported as its docs ask).
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
