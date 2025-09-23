import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    pool: "threads",
    include: ["src/__tests__/integration/api/swarm/stakgraph/*.test.ts"],
    setupFiles: ["./src/__tests__/integration/setup.ts"], // Use the simple setup without DB
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
