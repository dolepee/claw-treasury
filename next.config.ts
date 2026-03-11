import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["sodium-universal"] = path.resolve(
      process.cwd(),
      "src/lib/sodium-universal.ts",
    );

    return config;
  },
};

export default nextConfig;
