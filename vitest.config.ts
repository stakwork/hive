import { defineConfig } from "vitest/config";
import path from "path";


const testSuite = process.env.TEST_SUITE;

export default defineConfig({
  test: {
    // Use 'node' for integration tests (requires Node APIs like child_process)
    // Use 'jsdom' for unit tests (requires DOM APIs)
    environment: testSuite === "integration" ? "node" : "jsdom",
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
  esbuild: {
    // Use the automatic JSX runtime so components that omit `import React`
    // (Next.js / React 17+ new-transform style) work correctly in Vitest.
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@Universe": path.resolve(__dirname, "./src/components/knowledge-graph/Universe"),
    },
  },
});
