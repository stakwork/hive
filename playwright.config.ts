import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 60000,
  workers: 3,
  fullyParallel: true,
  globalSetup: './src/__tests__/e2e/support/setup/global-setup',
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
    // Always try to reuse existing server (CI manually starts it with proper env vars)
    reuseExistingServer: true,
    timeout: 120000,
  },
});
