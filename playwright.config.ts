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
    // Pass all environment variables from parent process to subprocess
    env: process.env as Record<string, string>,
  },
});
