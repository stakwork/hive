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
// Must happen before any module imports @/lib/db so Prisma reads the right URL.
ensureTestEnv();
process.env.DATABASE_URL = TEST_DATABASE_URL;

const initialFetch = globalThis.fetch;
const fetchState: Array<typeof globalThis.fetch> = [];

beforeAll(async () => {
  // Re-assert DATABASE_URL in case something reset it between module load and
  // beforeAll execution (e.g. dotenv/config in setupFiles).
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  // Explicitly connect and verify the Prisma client.
  // In Prisma 6 with Vitest forked workers the query engine binary can take
  // a moment to become reachable after $connect() resolves (especially on CI).
  // We retry with back-off so transient "Engine is not yet connected" errors
  // don't abort the whole suite.
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.$connect();
      await db.$queryRaw`SELECT 1`;
      break; // success
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      // Disconnect so the next attempt gets a fresh engine handshake
      await db.$disconnect().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
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
