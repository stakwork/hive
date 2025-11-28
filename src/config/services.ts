import { ServiceConfig } from "@/types";

// Service endpoint configurations
export const serviceConfigs: Record<string, ServiceConfig> = {
  stakwork: {
    baseURL:
      process.env.STAKWORK_BASE_URL || "https://jobs.stakwork.com/api/v1",
    apiKey: process.env.STAKWORK_API_KEY || "",
    timeout: parseInt(process.env.API_TIMEOUT || "10000"),
    headers: {
      "Content-Type": "application/json",
      "X-User-Email": process.env.STAKWORK_CUSTOMERS_EMAIL || "",
      "X-User-Password": process.env.STAKWORK_CUSTOMERS_PASSWORD || "",
    },
  },
  poolManager: {
    baseURL:
      process.env.POOL_MANAGER_API_KEY
        ? process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api"
        : process.env.NEXT_PUBLIC_API_BASE_URL
          ? `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/mock/pool-manager`
          : "http://localhost:3000/api/mock/pool-manager",
    apiKey: process.env.POOL_MANAGER_API_KEY || "",
    timeout: parseInt(process.env.API_TIMEOUT || "10000"),
    headers: {
      "Content-Type": "application/json",
    },
  },
  wizard: {
    baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "",
    apiKey: "", // Not needed for internal API calls
    timeout: 30000, // Longer timeout for wizard operations
    headers: {
      "Content-Type": "application/json",
    },
  },
  github: {
    baseURL: "https://api.github.com",
    apiKey: "",
    timeout: parseInt(process.env.API_TIMEOUT || "10000"),
    headers: {
      Accept: "application/vnd.github.v3+json",
    },
  },
  swarm: {
    baseURL: process.env.SWARM_SUPER_ADMIN_URL || "",
    apiKey: "", // Added under x-user-token
    timeout: 600000,
    headers: {
      "Content-Type": "application/json",
    },
  },
} as const;

// Service endpoints
export const endpoints = {
  stakwork: {
    projects: "/projects",
    proposals: "/proposals",
    users: "/users",
    categories: "/categories",
  },
  poolManager: {
    pools: "/pools",
    workspaces: "/workspaces",
    members: "/members",
    invitations: "/invitations",
  },
} as const;

// Validate required environment variables
export function validateServiceConfigs(): void {
  const requiredVars = {
    STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
    // POOL_MANAGER_API_KEY is optional - falls back to mock endpoints when not provided
  };

  for (const [key, value] of Object.entries(requiredVars)) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

// Get service config by name
export function getServiceConfig(
  serviceName: keyof typeof serviceConfigs,
): ServiceConfig {
  const config = serviceConfigs[serviceName];
  if (!config) {
    throw new Error(`Unknown service: ${serviceName}`);
  }
  return config;
}
