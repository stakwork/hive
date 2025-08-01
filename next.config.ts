import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
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
  // Enable SWC debug source mapping for React fiber inspection
  experimental: {
    swcPlugins: [],
  },
  compiler: {
    // Enable debug source information in development
    reactRemoveProperties: false,
    // Force React development mode for better debugging
    removeConsole: false,
  },
  // Ensure source maps are available for debugging (disabled in production)
  productionBrowserSourceMaps: process.env.NODE_ENV === "development",
};

export default nextConfig;
