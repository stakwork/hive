import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 60000,
  workers: 1, // Single worker to prevent parallel tests from deleting each other's data
  fullyParallel: false, // Run tests serially for database isolation
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
    baseURL: "http://localhost:3000",
    // Bypass Next.js dev overlay that intercepts pointer events
    bypassCSP: true,
  },
  testDir: "src/__tests__/e2e",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // In CI, don't reuse server so we can control env vars. Locally, reuse existing dev server.
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
