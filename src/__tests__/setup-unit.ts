// Unit test setup
import "@testing-library/jest-dom";
import { beforeAll, afterAll } from "vitest";

// Add any global test setup here
beforeAll(() => {
  // Setup any global test environment for unit tests
  // Use a valid 32-byte key represented as 64 hex chars
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    process.env.TOKEN_ENCRYPTION_KEY =
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY_ID) {
    process.env.TOKEN_ENCRYPTION_KEY_ID = "k-test";
  }

  // Set required environment variables for service integrations
  if (!process.env.STAKWORK_API_KEY) {
    process.env.STAKWORK_API_KEY = "test-stakwork-api-key";
  }
  if (!process.env.POOL_MANAGER_API_KEY) {
    process.env.POOL_MANAGER_API_KEY = "test-pool-manager-api-key";
  }
  if (!process.env.POOL_MANAGER_API_USERNAME) {
    process.env.POOL_MANAGER_API_USERNAME = "test-username";
  }
  if (!process.env.POOL_MANAGER_API_PASSWORD) {
    process.env.POOL_MANAGER_API_PASSWORD = "test-password";
  }
  if (!process.env.SWARM_SUPERADMIN_API_KEY) {
    process.env.SWARM_SUPERADMIN_API_KEY = "test-swarm-api-key";
  }
  if (!process.env.SWARM_SUPER_ADMIN_URL) {
    process.env.SWARM_SUPER_ADMIN_URL = "https://test-swarm-admin.com";
  }
  if (!process.env.STAKWORK_CUSTOMERS_EMAIL) {
    process.env.STAKWORK_CUSTOMERS_EMAIL = "test@example.com";
  }
  if (!process.env.STAKWORK_CUSTOMERS_PASSWORD) {
    process.env.STAKWORK_CUSTOMERS_PASSWORD = "test-password";
  }
});

afterAll(() => {
  // Cleanup after all unit tests
});
