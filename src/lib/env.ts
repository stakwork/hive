const requiredEnvVars = {
  STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
  POOL_MANAGER_API_KEY: process.env.POOL_MANAGER_API_KEY,
  POOL_MANAGER_API_USERNAME: process.env.POOL_MANAGER_API_USERNAME,
  POOL_MANAGER_API_PASSWORD: process.env.POOL_MANAGER_API_PASSWORD,
  SWARM_SUPERADMIN_API_KEY: process.env.SWARM_SUPERADMIN_API_KEY,
  SWARM_SUPER_ADMIN_URL: process.env.SWARM_SUPER_ADMIN_URL,
  STAKWORK_CUSTOMERS_EMAIL: process.env.STAKWORK_CUSTOMERS_EMAIL,
  STAKWORK_CUSTOMERS_PASSWORD: process.env.STAKWORK_CUSTOMERS_PASSWORD,
  //ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
} as const;

// Validate environment variables
for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = requiredEnvVars;

// Optional environment variables with defaults
export const optionalEnvVars = {
  STAKWORK_BASE_URL: process.env.STAKWORK_BASE_URL,
  STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
  POOL_MANAGER_BASE_URL: process.env.POOL_MANAGER_BASE_URL,
  POOL_MANAGER_API_KEY: process.env.POOL_MANAGER_API_KEY,
  POOL_MANAGER_API_USERNAME: process.env.POOL_MANAGER_API_USERNAME,
  POOL_MANAGER_API_PASSWORD: process.env.POOL_MANAGER_API_PASSWORD,
  ENABLE_JANITOR_WORKFLOW: process.env.ENABLE_JANITOR_WORKFLOW === "true",
  JANITOR_CRON_ENABLED: process.env.JANITOR_CRON_ENABLED === "true",
  CRON_SECRET: process.env.CRON_SECRET,
  POD_URL: process.env.POD_URL,
  GRAPH_SERVICE_PORT: process.env.GRAPH_SERVICE_PORT || "3355",
  PUSHER_APP_ID: process.env.PUSHER_APP_ID,
  PUSHER_KEY: process.env.PUSHER_KEY,
  PUSHER_SECRET: process.env.PUSHER_SECRET,
  PUSHER_CLUSTER: process.env.PUSHER_CLUSTER,
  USE_MOCKS: process.env.USE_MOCKS === "true",
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  STAKWORK_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_ID,
  STAKWORK_JANITOR_WORKFLOW_ID: process.env.STAKWORK_JANITOR_WORKFLOW_ID,
  STAKWORK_USER_JOURNEY_WORKFLOW_ID: process.env.STAKWORK_USER_JOURNEY_WORKFLOW_ID,
  STAKWORK_TRANSCRIPT_WORKFLOW_ID: process.env.STAKWORK_TRANSCRIPT_WORKFLOW_ID,
  STAKWORK_AI_GENERATION_WORKFLOW_ID: process.env.STAKWORK_AI_GENERATION_WORKFLOW_ID,
  API_TIMEOUT: parseInt(process.env.API_TIMEOUT || "10000"),
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
  LOG_LEVEL: process.env.LOG_LEVEL || "INFO",
} as const;

// Combined environment configuration
export const config = {
  ...requiredEnvVars,
  ...optionalEnvVars,
} as const;

/**
 * Get service URL - returns mock or real based on USE_MOCKS
 * @param serviceName - Name of the service
 * @returns Base URL for the service
 */
export function getServiceUrl(
  serviceName: "POOL_MANAGER" | "STAKWORK"
): string {
  if (config.USE_MOCKS) {
    // Return internal mock URLs
    const baseUrl = config.NEXTAUTH_URL || "http://localhost:3000";
    switch (serviceName) {
      case "POOL_MANAGER":
        return `${baseUrl}/api/mock/pool-manager`;
      case "STAKWORK":
        return `${baseUrl}/api/mock/stakwork`;
      default:
        throw new Error(`Unknown service: ${serviceName}`);
    }
  }

  // Return real service URLs
  switch (serviceName) {
    case "POOL_MANAGER":
      return config.POOL_MANAGER_BASE_URL || "";
    case "STAKWORK":
      return config.STAKWORK_BASE_URL || "";
    default:
      throw new Error(`Unknown service: ${serviceName}`);
  }
}

/**
 * Get service API key - returns mock or real based on USE_MOCKS
 * @param serviceName - Name of the service
 * @returns API key for the service
 */
export function getServiceApiKey(
  serviceName: "POOL_MANAGER" | "STAKWORK"
): string {
  if (config.USE_MOCKS) {
    return `mock-${serviceName.toLowerCase()}-key`;
  }

  switch (serviceName) {
    case "POOL_MANAGER":
      return config.POOL_MANAGER_API_KEY || "";
    case "STAKWORK":
      return config.STAKWORK_API_KEY || "";
    default:
      throw new Error(`Unknown service: ${serviceName}`);
  }
}
