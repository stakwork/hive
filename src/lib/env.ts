const requiredEnvVars = {
  STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
  POOL_MANAGER_API_KEY: process.env.POOL_MANAGER_API_KEY,
  POOL_MANAGER_API_USERNAME: process.env.POOL_MANAGER_API_USERNAME,
  POOL_MANAGER_API_PASSWORD: process.env.POOL_MANAGER_API_PASSWORD,
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

// Mock configuration - USE_MOCK_MODE overrides all individual service mocks
const USE_MOCK_MODE = process.env.USE_MOCK_MODE === 'true';
const USE_JARVIS_MOCK = USE_MOCK_MODE || process.env.USE_JARVIS_MOCK === 'true';
const USE_STAKWORK_MOCK = USE_MOCK_MODE || process.env.USE_STAKWORK_MOCK === 'true' || !process.env.STAKWORK_API_KEY;
const USE_SWARM_MOCK = USE_MOCK_MODE || process.env.USE_SWARM_MOCK === 'true' || !process.env.SWARM_SUPERADMIN_API_KEY;

// Optional environment variables with defaults
export const optionalEnvVars = {
  STAKWORK_BASE_URL: USE_STAKWORK_MOCK
    ? (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, '') + "/api/mock/stakwork"
    : process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1",
  STAKWORK_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_ID,
  STAKWORK_JANITOR_WORKFLOW_ID: process.env.STAKWORK_JANITOR_WORKFLOW_ID,
  STAKWORK_USER_JOURNEY_WORKFLOW_ID: process.env.STAKWORK_USER_JOURNEY_WORKFLOW_ID,
  STAKWORK_TRANSCRIPT_WORKFLOW_ID: process.env.STAKWORK_TRANSCRIPT_WORKFLOW_ID,
  STAKWORK_AI_GENERATION_WORKFLOW_ID: process.env.STAKWORK_AI_GENERATION_WORKFLOW_ID,
  POOL_MANAGER_BASE_URL: process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api",
  SWARM_SUPER_ADMIN_URL: USE_SWARM_MOCK
    ? (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, '') + "/api/mock/swarm"
    : process.env.SWARM_SUPER_ADMIN_URL,
  SWARM_SUPERADMIN_API_KEY: USE_SWARM_MOCK
    ? "mock-swarm-token"
    : process.env.SWARM_SUPERADMIN_API_KEY,
  API_TIMEOUT: parseInt(process.env.API_TIMEOUT || "10000"),
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
  LOG_LEVEL: process.env.LOG_LEVEL || "INFO",
  // Mock configuration flags
  USE_MOCK_MODE,
  USE_JARVIS_MOCK,
  USE_STAKWORK_MOCK,
  USE_SWARM_MOCK,
  CUSTOM_SWARM_URL: USE_JARVIS_MOCK
    ? (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/+$/, '') + "/api/mock/jarvis"
    : process.env.CUSTOM_SWARM_URL,
  CUSTOM_SWARM_API_KEY: USE_JARVIS_MOCK
    ? "mock-api-key"
    : process.env.CUSTOM_SWARM_API_KEY,
} as const;

// Combined environment configuration
export const config = {
  ...requiredEnvVars,
  ...optionalEnvVars,
} as const;
