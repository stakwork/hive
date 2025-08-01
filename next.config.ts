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
    // React transform settings
    ...(process.env.NODE_ENV === "development" && {
      react: {
        // Enable development mode for React transform
        development: true,
        // Use the development runtime
        runtime: "automatic",
      },
    }),
  },
  // Development-specific settings
  ...(process.env.NODE_ENV === "development" && {
    // Enable source maps in development
    productionBrowserSourceMaps: true,
    // Additional development optimizations
    swcMinify: false,
  }),
  // Ensure source maps are available for debugging (disabled in production)
  productionBrowserSourceMaps: process.env.NODE_ENV === "development",
};

export default nextConfig;
