import { defineConfig } from "vitest/config";
import path from "path";
import react from '@vitejs/plugin-react';

const testSuite = process.env.TEST_SUITE;

export default defineConfig({
  plugins: testSuite === "integration" ? [] : [react()],
  test: {
    environment: testSuite === "integration" ? "node" : "jsdom",
    globals: true,
    // Run integration tests sequentially to avoid database conflicts
    pool: testSuite === "integration" ? "forks" : "threads",
    poolOptions: testSuite === "integration" ? {
      forks: {
        singleFork: true,
      },
    } : undefined,
    include:
      testSuite === "integration"
        ? ["src/__tests__/integration/**/*.test.ts"]
        : ["src/__tests__/unit/**/*.test.{ts,tsx}"],
    setupFiles:
      testSuite === "integration"
        ? ["./src/__tests__/setup-integration.ts"]
        : ["./src/__tests__/setup-unit.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
