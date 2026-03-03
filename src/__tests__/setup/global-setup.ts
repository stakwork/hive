/**
 * Vitest globalSetup — runs once in the main process BEFORE any test forks.
 * Used to push the Prisma schema to the test database so the engine is ready
 * by the time the fork process imports the Prisma client.
 */
import { execSync } from "child_process";

export async function setup() {
  const DATABASE_URL =
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL or DATABASE_URL must be set for integration tests",
    );
  }

  try {
    execSync("npx prisma db push --accept-data-loss", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL },
    });
  } catch (error) {
    console.error("globalSetup: Failed to push Prisma schema:", error);
    throw error;
  }
}

export async function teardown() {
  // Nothing to tear down — the DB container is managed externally.
}
