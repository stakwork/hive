import { defineConfig } from "vitest/config";
import path from "path";

const testSuite = process.env.TEST_SUITE;

// Suppress logger output during unit tests — only errors are shown.
// Integration tests may assert on logger output so we leave their level as-is.
if (!testSuite || testSuite === 'unit') {
  process.env.LOG_LEVEL = 'ERROR';
}

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
    // Run integration tests sequentially in a single forked child process.
    // Using "forks" + singleFork means the child process properly inherits
    // NODE_OPTIONS (including --max-old-space-size) from the environment,
    // unlike vmThreads workers which don't receive V8 heap flags.
    // singleFork ensures Prisma's library engine is initialised exactly once,
    // avoiding the "Engine is not yet connected" race seen with multiple forks.
    pool: testSuite === "integration" ? "forks" : "threads",
    poolOptions: testSuite === "integration" ? {
      forks: {
        singleFork: true,
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
