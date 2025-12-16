import { defineConfig } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  timeout: isCI ? 90000 : 60000, // Longer timeout in CI
  workers: 1, // Single worker to prevent parallel tests from deleting each other's data
  fullyParallel: false, // Run tests serially for database isolation
  retries: isCI ? 2 : 0, // Retry failed tests in CI
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: isCI ? "retain-on-failure" : "off",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  testDir: "src/__tests__/e2e",
});
