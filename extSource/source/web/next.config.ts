import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@backlink-autofill/shared"],
  ...(process.env.MAHID_PORTABLE_BUILD === "1" ? {
    output: "standalone" as const,
    distDir: ".next-portable",
    outputFileTracingRoot: process.cwd().replace(/[\\/]web$/, ""),
  } : {}),
};

export default nextConfig;
