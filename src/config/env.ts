// Mock mode - when true, URLs resolve to local mock endpoints
const USE_MOCKS = process.env.USE_MOCKS === "true";
const MOCK_BASE = process.env.NEXTAUTH_URL || "http://localhost:3000";

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

// Validate environment variables at runtime (skip in mock mode)
export function validateEnvVars(): void {
  if (USE_MOCKS) return;

  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

export const env = requiredEnvVars;

// Optional environment variables with defaults
// URLs resolve to mock endpoints when USE_MOCKS=true
export const optionalEnvVars = {
  // GitHub OAuth token exchange URL (used by GitHub App callback)
  GITHUB_OAUTH_TOKEN_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/github/oauth/access_token`
    : "https://github.com/login/oauth/access_token",
  // Gemini API base URL (routes to mock endpoint when USE_MOCKS=true)
  GEMINI_API_BASE_URL: USE_MOCKS ? `${MOCK_BASE}/api/mock/gemini` : "https://generativelanguage.googleapis.com",
  STAKWORK_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/stakwork`
    : process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1",
  STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
  STAKWORK_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_ID,
  STAKWORK_JANITOR_WORKFLOW_ID: process.env.STAKWORK_JANITOR_WORKFLOW_ID,
  STAKWORK_USER_JOURNEY_WORKFLOW_ID: process.env.STAKWORK_USER_JOURNEY_WORKFLOW_ID,
  STAKWORK_TRANSCRIPT_WORKFLOW_ID: process.env.STAKWORK_TRANSCRIPT_WORKFLOW_ID,
  STAKWORK_AI_GENERATION_WORKFLOW_ID: process.env.STAKWORK_AI_GENERATION_WORKFLOW_ID,
  STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID,
  POOL_MANAGER_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/pool-manager`
    : process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api",
  SWARM_SUPER_ADMIN_URL: USE_MOCKS ? `${MOCK_BASE}/api/mock/swarm-super-admin` : process.env.SWARM_SUPER_ADMIN_URL,
  LIVEKIT_CALL_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/livekit/`
    : process.env.LIVEKIT_CALL_BASE_URL || "https://call.livekit.io/",
  API_TIMEOUT: parseInt(process.env.API_TIMEOUT || "10000"),
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
  LOG_LEVEL: process.env.LOG_LEVEL || "INFO",
  USE_MOCKS,
  MOCK_BASE,
} as const;

/**
 * Validates and returns Gemini API key
 * Returns mock key when USE_MOCKS=true, else reads from environment
 * @throws Error if GEMINI_API_KEY is not set and USE_MOCKS=false
 */
export function getGeminiApiKey(): string {
  // Return mock API key in mock mode
  if (USE_MOCKS) {
    return "mock-gemini-key-12345";
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set. " + "Please add it to your .env file.");
  }

  return apiKey;
}

/**
 * Checks if Gemini API key is configured
 */
export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// Combined environment configuration
export const config = {
  ...requiredEnvVars,
  ...optionalEnvVars,
  geminiApiKey: process.env.GEMINI_API_KEY,
} as const;
