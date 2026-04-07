import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "@xyflow/react",
      "@react-three/drei",
      "@react-three/fiber",
      "@sentry/nextjs",
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-request-presigner",
      "@excalidraw/excalidraw",
      "ai",
      "d3",
      "react-syntax-highlighter",
      "react-hook-form",
      "@hookform/resolvers",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
    ],
  },
  reactStrictMode: false,
  async redirects() {
    return [
      {
        source: "/w/:slug/stakgraph",
        destination: "/w/:slug/settings?tab=pool",
        permanent: false,
      },
    ];
  },
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPE_CHECK === "true",
  },
  serverExternalPackages: ["sharp"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
