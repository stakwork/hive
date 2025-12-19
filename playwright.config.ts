import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 60000,
  // Configurable workers:
  // - Local: 1 worker (serial execution for database isolation)
  // - CI: 2 workers per test group (each matrix job has isolated DB, can run tests in parallel)
  workers: parseInt(process.env.PLAYWRIGHT_WORKERS || (process.env.CI ? "2" : "1")),
  // Keep fullyParallel false to run tests serially within each worker for database isolation
  // The parallelization happens at the GitHub Actions matrix level (7 groups)
  // and within each group via multiple workers
  fullyParallel: false,
  // Retry failed tests once in CI to handle flakiness
  retries: process.env.CI ? 1 : 0,
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
    // Increase timeout for slower CI environments
    actionTimeout: 10000,
    navigationTimeout: 30000,
    // Bypass Next.js dev overlay that intercepts pointer events
    bypassCSP: true,
  },
  testDir: "src/__tests__/e2e",
  // Reporter configuration for better CI output
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
