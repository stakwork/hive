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
    // Run integration tests sequentially to avoid database conflicts.
    // forks pool spawns a single child process (singleFork: true) which
    // inherits NODE_OPTIONS from the parent — including the --max-old-space-size
    // set by CI — so the child never hits the default ~1.5 GB V8 heap limit.
    // vmThreads/threads worker threads do not inherit NODE_OPTIONS and reject
    // --max-old-space-size in execArgv, causing ERR_WORKER_INVALID_EXEC_ARGV.
    // A single fork also ensures Prisma's native library engine is initialised
    // once, avoiding the "Engine is not yet connected" race seen with multiple forks.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
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
