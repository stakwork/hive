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
    // Enable Babel for development builds to inject source mapping
    experimental: {
        turbo: process.env.NODE_ENV === 'development' ? {
            rules: {
                '*.{js,jsx,ts,tsx}': {
                    loaders: ['babel-loader'],
                    as: '*.js'
                }
            }
        } : undefined
    }
};

export default nextConfig;
