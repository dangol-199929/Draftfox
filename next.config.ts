import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray pnpm-lock.yaml in the home folder would otherwise be picked as the workspace root.
  turbopack: { root: import.meta.dirname },
  // Native (resvg) and WebAssembly (satori's layout engine) packages for drawing post images; load them as is.
  serverExternalPackages: ["@resvg/resvg-js", "satori"],
  // Pages that moved into a section of the app; old links and bookmarks still work.
  async redirects() {
    return [
      { source: "/posts", destination: "/", permanent: false },
      { source: "/posts/:id", destination: "/?post=:id", permanent: false },
      { source: "/prompt", destination: "/settings", permanent: false },
      { source: "/linkedin", destination: "/profile", permanent: false },
    ];
  },
};

export default nextConfig;
