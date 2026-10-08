import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray pnpm-lock.yaml in the home folder would otherwise be picked as the workspace root.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
