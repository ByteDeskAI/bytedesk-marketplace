import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static export — the build emits out/, deployable to any static host.
  // Swap or remove this if the site grows server-rendered routes.
  output: "export",
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
