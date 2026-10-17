import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sendsure/core", "@sendsure/chain"],
  output: "standalone",
  poweredByHeader: false,
  // The mainnet beta has no demo (it runs on test money): its /try opens the testnet one.
  async redirects() {
    return process.env.NEXT_PUBLIC_ARC_NETWORK === "mainnet"
      ? [{ source: "/try", destination: "https://sendsure.0xpankaj.workers.dev/try", permanent: false }]
      : [];
  },
};

export default config;
