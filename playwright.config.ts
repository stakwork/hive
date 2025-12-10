import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30000,
  workers: 1, // Single worker to prevent parallel tests from deleting each other's data
  fullyParallel: false, // Run tests serially for database isolation
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
  },
  testDir: "src/__tests__/e2e",
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Enable feature flags for E2E tests
      NEXT_PUBLIC_FEATURE_CODEBASE_RECOMMENDATION: "true",
    },
  },
});
