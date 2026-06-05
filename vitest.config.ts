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
    // forks pool with singleFork keeps all tests in one child process (so the
    // Prisma native addon is initialised only once), while also inheriting
    // NODE_OPTIONS from the parent — allowing --max-old-space-size to take effect.
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
