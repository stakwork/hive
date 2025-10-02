import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30000,
  use: {
    headless: true,
    browserName: "chromium",
    trace: "on-first-retry",
  },
  testDir: "src/__tests__/e2e",
});
