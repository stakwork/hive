import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true, // Skip TypeScript errors during build
  },
  experimental: {
    workerThreads: false, // Disable worker threads to prevent memory issues
    cpus: 1, // Limit CPU usage
  },
  webpack: (config, { isServer }) => {
    // Reduce memory pressure
    config.resolve.symlinks = false;
    
    // Optimize for memory usage
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...config.optimization?.splitChunks,
        maxSize: 244000, // Limit chunk sizes
      },
    };
    
    return config;
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
};

export default nextConfig;
