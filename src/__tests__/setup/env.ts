/**
 * Shared test environment setup
 * Ensures consistent environment variables across unit and integration tests
 */

interface TestEnvDefaults {
  TOKEN_ENCRYPTION_KEY: string;
  TOKEN_ENCRYPTION_KEY_ID: string;
  STAKWORK_API_KEY: string;
  POOL_MANAGER_API_KEY: string;
  POOL_MANAGER_API_USERNAME: string;
  POOL_MANAGER_API_PASSWORD: string;
  SWARM_SUPERADMIN_API_KEY: string;
  SWARM_SUPER_ADMIN_URL: string;
  STAKWORK_CUSTOMERS_EMAIL: string;
  STAKWORK_CUSTOMERS_PASSWORD: string;
  API_TOKEN: string;
  USE_MOCKS: string;
  AWS_ROLE_ARN: string;
  S3_BUCKET_NAME: string;
  AWS_REGION: string;
}

const TEST_ENV_DEFAULTS: TestEnvDefaults = {
  TOKEN_ENCRYPTION_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  TOKEN_ENCRYPTION_KEY_ID: "k-test",
  STAKWORK_API_KEY: "test-stakwork",
  POOL_MANAGER_API_KEY: "test-pool",
  POOL_MANAGER_API_USERNAME: "user",
  POOL_MANAGER_API_PASSWORD: "pass",
  SWARM_SUPERADMIN_API_KEY: "super",
  SWARM_SUPER_ADMIN_URL: "https://super.test",
  STAKWORK_CUSTOMERS_EMAIL: "c@test.local",
  STAKWORK_CUSTOMERS_PASSWORD: "secret",
  API_TOKEN: "test-api-token",
  USE_MOCKS: "false",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/test-role",
  S3_BUCKET_NAME: "test-bucket",
  AWS_REGION: "us-east-1",
};

/**
 * Validate if a string is valid hex-encoded encryption key (64 hex chars = 32 bytes)
 */
function isValidEncryptionKey(key: string | undefined): boolean {
  return !!(key && /^[0-9a-fA-F]{64}$/.test(key));
}

/**
 * Ensure test environment variables are set with default values
 * Overrides invalid TOKEN_ENCRYPTION_KEY to prevent test failures
 * 
 * Note: Dev environments may have plain-text encryption keys that break tests.
 * Tests require valid hex-encoded 32-byte keys (64 hex characters).
 */
export function ensureTestEnv(): void {
  Object.entries(TEST_ENV_DEFAULTS).forEach(([key, value]) => {
    // Special handling for TOKEN_ENCRYPTION_KEY: must be valid hex format
    if (key === 'TOKEN_ENCRYPTION_KEY') {
      if (!isValidEncryptionKey(process.env[key])) {
        process.env[key] = value;
      }
    } else if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
