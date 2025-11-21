import "./global";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { resetDatabase } from "../support/fixtures";
import { ensureTestEnv } from "./env";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL environment variable is required for integration tests");
}

if (!TEST_DATABASE_URL.includes("test") && !process.env.NODE_ENV?.includes("test")) {
  console.warn("WARNING: DATABASE_URL does not contain 'test' - ensure you're using a test database");
}

// Set environment variables for integration tests using shared helper
ensureTestEnv();
process.env.DATABASE_URL = TEST_DATABASE_URL;

const initialFetch = globalThis.fetch;
const fetchState: Array<typeof globalThis.fetch> = [];

beforeAll(async () => {
  // Ensure database URL is set for Prisma
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
  }

  try {
    execSync("npx prisma db push --accept-data-loss", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
  } catch (error) {
    console.error("Failed to setup test database schema:", error);
    throw error;
  }
});

// Reset database before each test to ensure clean state.
// No afterEach needed - beforeEach provides full isolation.
beforeEach(async () => {
  fetchState.push(globalThis.fetch);
  await resetDatabase();
});

afterEach(() => {
  const previousFetch = fetchState.pop();
  globalThis.fetch = previousFetch ?? initialFetch;
});

afterAll(async () => {
  await db.$disconnect();
});
