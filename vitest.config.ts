import { defineConfig } from "vitest/config";
import path from "path";

const testSuite = process.env.TEST_SUITE;

export default defineConfig({
  test: {
    // Use 'node' for integration tests (requires Node APIs like child_process)
    // Use 'jsdom' for unit tests (requires DOM APIs)
    environment: testSuite === "integration" ? "node" : "jsdom",
    globals: true,
    // Run integration tests sequentially to avoid database conflicts
    pool: testSuite === "integration" ? "forks" : "threads",
    poolOptions: testSuite === "integration" ? {
      forks: {
        singleFork: true,
      },
    } : undefined,
    // globalSetup runs in the main process BEFORE the fork starts.
    // Used to push the DB schema so the Prisma engine is ready in the fork.
    globalSetup: testSuite === "integration"
      ? ["./src/__tests__/setup/global-setup.ts"]
      : undefined,
    include:
      testSuite === "integration"
        ? ["src/__tests__/integration/**/*.test.{ts,tsx}"]
        : testSuite === "api"
        ? ["src/__tests__/api/**/*.test.ts"]
        : ["src/__tests__/unit/**/*.test.{ts,tsx}"],
    // dotenv/config must come first so DATABASE_URL is in process.env
    // before integration.ts imports @/lib/db and reads it.
    setupFiles:
      testSuite === "integration"
        ? ['dotenv/config', "./src/__tests__/setup/integration.ts"]
        : testSuite === "api"
        ? ['dotenv/config', "./src/__tests__/setup/unit.ts"]
        : ['dotenv/config', "./src/__tests__/setup/unit.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@Universe": path.resolve(__dirname, "./src/components/knowledge-graph/Universe"),
    },
  },
});
