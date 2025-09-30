import { vi } from "vitest";

/**
 * Mock for @/lib/env to prevent environment variable validation errors in unit tests.
 *
 * src/lib/env.ts validates required env vars on import, which crashes unit tests.
 * This mock provides test-safe defaults for all required environment variables.
 */

const mockEnv = {
  STAKWORK_API_KEY: "test-stakwork-key",
  POOL_MANAGER_API_KEY: "test-pool-key",
  POOL_MANAGER_API_USERNAME: "test-user",
  POOL_MANAGER_API_PASSWORD: "test-pass",
  SWARM_SUPERADMIN_API_KEY: "test-swarm-key",
  SWARM_SUPER_ADMIN_URL: "https://swarm.test",
  STAKWORK_CUSTOMERS_EMAIL: "test@example.com",
  STAKWORK_CUSTOMERS_PASSWORD: "test-password",
};

const mockConfig = {
  ...mockEnv,
  STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  STAKWORK_WORKFLOW_ID: "test-workflow-id",
  STAKWORK_JANITOR_WORKFLOW_ID: "test-janitor-workflow-id",
  STAKWORK_USER_JOURNEY_WORKFLOW_ID: "test-user-journey-workflow-id",
  POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
  API_TIMEOUT: 10000,
  GITHUB_APP_SLUG: "test-github-app",
  GITHUB_APP_CLIENT_ID: "test-client-id",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  LOG_LEVEL: "INFO",
};

vi.mock("@/lib/env", () => ({
  env: mockEnv,
  config: mockConfig,
  optionalEnvVars: {
    STAKWORK_BASE_URL: mockConfig.STAKWORK_BASE_URL,
    STAKWORK_WORKFLOW_ID: mockConfig.STAKWORK_WORKFLOW_ID,
    STAKWORK_JANITOR_WORKFLOW_ID: mockConfig.STAKWORK_JANITOR_WORKFLOW_ID,
    STAKWORK_USER_JOURNEY_WORKFLOW_ID: mockConfig.STAKWORK_USER_JOURNEY_WORKFLOW_ID,
    POOL_MANAGER_BASE_URL: mockConfig.POOL_MANAGER_BASE_URL,
    API_TIMEOUT: mockConfig.API_TIMEOUT,
    GITHUB_APP_SLUG: mockConfig.GITHUB_APP_SLUG,
    GITHUB_APP_CLIENT_ID: mockConfig.GITHUB_APP_CLIENT_ID,
    GITHUB_APP_CLIENT_SECRET: mockConfig.GITHUB_APP_CLIENT_SECRET,
    LOG_LEVEL: mockConfig.LOG_LEVEL,
  },
}));

export { mockEnv, mockConfig };