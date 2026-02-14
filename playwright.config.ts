import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 60000,
  workers: 1, // Single worker to prevent parallel tests from deleting each other's data
  fullyParallel: false, // Run tests serially for database isolation
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
    // Bypass Next.js dev overlay that intercepts pointer events
    bypassCSP: true,
  },
  testDir: "src/__tests__/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: process.env.CI ? {
      DATABASE_URL: "postgresql://hive_user:hive_password@localhost:5432/hive_db",
      NEXTAUTH_URL: "http://localhost:3000",
      NEXTAUTH_SECRET: "fake_secret",
      JWT_SECRET: "fake_secret",
      GITHUB_CLIENT_ID: "fake_secret",
      GITHUB_CLIENT_SECRET: "fake_secret",
      TOKEN_ENCRYPTION_KEY: "fake_secret",
      TOKEN_ENCRYPTION_KEY_ID: "test-key-1",
      STAKWORK_API_KEY: "fake_secret",
      STAKWORK_BASE_URL: "https://jobs.stakwork.com/api/v1",
      STAKWORK_CUSTOMERS_EMAIL: "fake_secret",
      STAKWORK_CUSTOMERS_PASSWORD: "fake_secret",
      POOL_MANAGER_API_KEY: "fake_secret",
      POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
      SWARM_SUPERADMIN_API_KEY: "fake_secret",
      POOL_MANAGER_API_USERNAME: "fake_secret",
      POOL_MANAGER_API_PASSWORD: "fake_secret",
      SWARM_SUPER_ADMIN_URL: "placeholder",
      GITHUB_APP_SLUG: "hivechatai",
      POD_URL: "http://localhost:3000",
      NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION: "true",
    } : undefined,
  },
});
