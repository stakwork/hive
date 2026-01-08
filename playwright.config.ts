import { defineConfig, devices } from "@playwright/test";

// Get worker index for database isolation (defaults to 0 for single-worker mode)
const workerIndex = process.env.PLAYWRIGHT_WORKER_INDEX || "0";

// Construct worker-specific database URL for parallel test execution
const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL || "";
  
  // In CI with multiple workers, use worker-specific database
  if (process.env.CI && parseInt(workerIndex) > 0) {
    return baseUrl.replace(/\/([^/]+)$/, `/$1_${workerIndex}`);
  }
  
  return baseUrl;
};

const config = defineConfig({
  testDir: "./src/__tests__/e2e/specs",
  timeout: 60 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Enable parallel workers in CI for faster test execution
  // Each worker uses isolated database (hive_db_0, hive_db_1, etc.)
  workers: process.env.CI ? 4 : 1,
  reporter: "html",
  use: {
    baseURL: process.env.NEXTAUTH_URL || "http://localhost:3000",
    trace: "on-first-retry",
    headless: true,
    bypassCSP: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      DATABASE_URL: getDatabaseUrl(),
    },
  },
});

export default config;
