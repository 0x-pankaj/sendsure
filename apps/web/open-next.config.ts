import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// SendSure runs on Cloudflare Workers (Pankaj's account). No incremental cache needed: every page
// is static and every API route is dynamic.
export default defineCloudflareConfig({});
