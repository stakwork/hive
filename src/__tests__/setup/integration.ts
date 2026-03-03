import "./global";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "../support/utilities/database";
import { ensureTestEnv } from "./env";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL or DATABASE_URL environment variable is required for integration tests",
  );
}

if (
  !TEST_DATABASE_URL.includes("test") &&
  !process.env.NODE_ENV?.includes("test")
) {
  console.warn(
    "WARNING: DATABASE_URL does not contain 'test' - ensure you're using a test database",
  );
}

// Set environment variables for integration tests using shared helper.
ensureTestEnv();
process.env.DATABASE_URL = TEST_DATABASE_URL;

const initialFetch = globalThis.fetch;
const fetchState: Array<typeof globalThis.fetch> = [];

beforeAll(async () => {
  // Re-assert DATABASE_URL in case something reset it between module load and
  // beforeAll execution.
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  // Establish the Prisma connection once before any tests run.
  await db.$connect();
  await db.$queryRaw`SELECT 1`;
}, 30_000);

// Reset database before each test to ensure clean state.
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
