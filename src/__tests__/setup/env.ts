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
  PUSHER_APP_ID: string;
  PUSHER_KEY: string;
  PUSHER_SECRET: string;
  PUSHER_CLUSTER: string;
  NEXT_PUBLIC_PUSHER_KEY: string;
  NEXT_PUBLIC_PUSHER_CLUSTER: string;
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
  PUSHER_APP_ID: "test-pusher-app-id",
  PUSHER_KEY: "test-pusher-key",
  PUSHER_SECRET: "test-pusher-secret",
  PUSHER_CLUSTER: "test-cluster",
  NEXT_PUBLIC_PUSHER_KEY: "test-pusher-key",
  NEXT_PUBLIC_PUSHER_CLUSTER: "test-cluster",
};

/**
 * Ensure test environment variables are set with default values
 * Only sets values if not already defined in process.env
 */
export function ensureTestEnv(): void {
  Object.entries(TEST_ENV_DEFAULTS).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}
