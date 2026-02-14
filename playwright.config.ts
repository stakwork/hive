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
    reuseExistingServer: !process.env.CI, // Don't reuse in CI to ensure clean env
    timeout: 120000,
    env: {
      // Explicitly pass environment variables to the dev server
      DATABASE_URL: process.env.DATABASE_URL,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      JWT_SECRET: process.env.JWT_SECRET,
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
      TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
      TOKEN_ENCRYPTION_KEY_ID: process.env.TOKEN_ENCRYPTION_KEY_ID || '1',
      STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
      STAKWORK_BASE_URL: process.env.STAKWORK_BASE_URL,
      STAKWORK_CUSTOMERS_EMAIL: process.env.STAKWORK_CUSTOMERS_EMAIL,
      STAKWORK_CUSTOMERS_PASSWORD: process.env.STAKWORK_CUSTOMERS_PASSWORD,
      POOL_MANAGER_API_KEY: process.env.POOL_MANAGER_API_KEY,
      POOL_MANAGER_BASE_URL: process.env.POOL_MANAGER_BASE_URL,
      SWARM_SUPERADMIN_API_KEY: process.env.SWARM_SUPERADMIN_API_KEY,
      POOL_MANAGER_API_USERNAME: process.env.POOL_MANAGER_API_USERNAME,
      POOL_MANAGER_API_PASSWORD: process.env.POOL_MANAGER_API_PASSWORD,
      SWARM_SUPER_ADMIN_URL: process.env.SWARM_SUPER_ADMIN_URL,
      GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
      POD_URL: process.env.POD_URL,
      NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION: process.env.NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION,
    },
  },
});
