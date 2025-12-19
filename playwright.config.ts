import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  timeout: 60000,
  // Enable parallel execution with database locking to prevent race conditions
  // Limit workers due to database reset serialization requirement
  workers: process.env.CI ? 2 : 4, // 2 workers in CI, 4 locally (conservative)
  fullyParallel: true, // Run tests in parallel with synchronized database resets
  
  // Fail fast in CI to save resources
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests once
  retries: process.env.CI ? 1 : 0,
  
  // Reporter configuration
  reporter: process.env.CI ? "github" : "list",
  
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
    // Bypass Next.js dev overlay that intercepts pointer events
    bypassCSP: true,
    // Screenshot on failure for debugging
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  
  testDir: "src/__tests__/e2e",
  
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120000,
  },
  
  // Optional: Define projects for different browsers (commented out by default)
  // projects: [
  //   {
  //     name: 'chromium',
  //     use: { ...devices['Desktop Chrome'] },
  //   },
  //   {
  //     name: 'firefox',
  //     use: { ...devices['Desktop Firefox'] },
  //   },
  //   {
  //     name: 'webkit',
  //     use: { ...devices['Desktop Safari'] },
  //   },
  // ],
});
