import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@sendsure/core", "@sendsure/chain"],
  output: "standalone",
  poweredByHeader: false,
};

export default config;
