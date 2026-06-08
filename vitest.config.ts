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
    // threads (vs forks) keeps everything in one Node process, which means
    // the Prisma library engine (.so.node native addon) is initialised once and
    // shared — avoiding the "Engine is not yet connected" race that occurs when
    // Prisma 6's library engine is re-initialised inside a forked child process.
    // vmThreads was previously used here but does not propagate NODE_OPTIONS to
    // the worker thread, so the worker hits the default ~1.5 GB V8 heap limit
    // even when the parent process has a higher limit. threads supports execArgv,
    // which lets us explicitly raise the heap ceiling for the worker.
    pool: "threads",
    poolOptions: testSuite === "integration" ? {
      threads: {
        singleThread: true,
        execArgv: ["--max-old-space-size=4096"],
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
