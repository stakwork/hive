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
  STAKWORK_BASE_URL:
    process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1",
  STAKWORK_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_ID,
  POOL_MANAGER_BASE_URL:
    process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api",
  API_TIMEOUT: parseInt(process.env.API_TIMEOUT || "10000"),
} as const;

// Combined environment configuration
export const config = {
  ...requiredEnvVars,
  ...optionalEnvVars,
} as const;
