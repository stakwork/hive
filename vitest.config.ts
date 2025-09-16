import { defineConfig } from "vitest/config";
import path from "path";

const testSuite = process.env.TEST_SUITE;

export default defineConfig({
  test: {
    environment: "node",
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
        : testSuite === "api"
        ? ["src/__tests__/api/**/*.test.ts"]
        : ["src/__tests__/unit/**/*.test.ts"],
    setupFiles:
      testSuite === "integration"
        ? ["./src/__tests__/setup-integration.ts"]
        : testSuite === "api"
        ? ["./src/__tests__/setup-unit.ts"] // API tests can use unit test setup
        : ["./src/__tests__/setup-unit.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
