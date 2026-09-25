import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  env: {
    NEXT_PUBLIC_BASE_PATH: githubPages ? "/presence-tracker" : "",
  },
  ...(githubPages
    ? {
        output: "export",
        basePath: "/presence-tracker",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
