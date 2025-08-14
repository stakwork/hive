import { defineConfig } from "vitest/config";
import path from "path";

const testSuite = process.env.TEST_SUITE;

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include:
      testSuite === "integration"
        ? ["src/__tests__/integration/**/*.test.ts"]
        : ["src/__tests__/unit/**/*.test.ts"],
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
