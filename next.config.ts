import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
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
