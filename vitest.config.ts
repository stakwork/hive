import { defineConfig } from "vitest/config";
import path from "path";

// Suppress logger output during tests — only errors are shown
process.env.LOG_LEVEL = 'ERROR';

const testSuite = process.env.TEST_SUITE;

export default defineConfig({
  test: {
    // Default to 'node' — only files that need DOM APIs opt in to jsdom
    // via environmentMatchGlobs or per-file @vitest-environment directive
    environment: "node",
    environmentMatchGlobs:
      testSuite === "integration" || testSuite === "api"
        ? undefined
        : [
            ["**/*.test.tsx", "jsdom"],
            ["**/hooks/**/*.test.ts", "jsdom"],
          ],
    globals: true,
    // Run integration tests sequentially to avoid database conflicts.
    // vmThreads (vs forks) keeps everything in one Node process, which means
    // the Prisma library engine (.so.node native addon) is initialised once and
    // shared — avoiding the "Engine is not yet connected" race that occurs when
    // Prisma 6's library engine is re-initialised inside a forked child process.
    pool: testSuite === "integration" ? "vmThreads" : "threads",
    poolOptions: testSuite === "integration" ? {
      vmThreads: {
        singleThread: true,
      },
    } : undefined,
    include:
      testSuite === "integration"
        ? ["src/__tests__/integration/**/*.test.{ts,tsx}"]
        : testSuite === "api"
        ? ["src/__tests__/api/**/*.test.ts"]
        : ["src/__tests__/unit/**/*.test.{ts,tsx}"],
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
