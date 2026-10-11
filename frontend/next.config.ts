import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: "http://localhost:8000/auth/:path*",
      },
      {
        source: "/api/blackjack/:path*",
        destination: "http://localhost:8000/:path*",
      },
      {
        source: "/api/shop/:path*",
        destination: "http://localhost:8000/shop/:path*",
      },
      {
        source: "/api/shop",
        destination: "http://localhost:8000/shop",
      },
    ];
  },
};

export default nextConfig;
