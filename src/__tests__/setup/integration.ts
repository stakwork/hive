import "./global";
import { beforeEach, afterEach } from "vitest";
import { resetDatabase } from "../support/utilities/database";
import { ensureTestEnv } from "./env";
import { assertTestDatabaseUrl } from "../support/utilities/test-database-guard";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

// Throws unless the database name contains "test" — resetDatabase() below
// empties every table before each test.
assertTestDatabaseUrl(TEST_DATABASE_URL);

// Set environment variables for integration tests using shared helper.
ensureTestEnv();
process.env.DATABASE_URL = TEST_DATABASE_URL;

const initialFetch = globalThis.fetch;
const fetchState: Array<typeof globalThis.fetch> = [];

// Reset database before each test to ensure clean state.
// Prisma connects lazily on the first ORM call inside resetDatabase().
// No explicit $connect()/$disconnect() is needed: with singleFork the process
// exits after all files complete, cleaning up connections automatically.
//
// resetDatabase() is a long chain of deleteMany() calls, so its cost tracks
// whatever the previous test left behind — the seed-script files leave enough
// that a loaded CI runner overruns vitest's 10s default and the whole file
// fails in the hook. The explicit budget below is for the reset alone; test
// bodies keep the default timeout.
const RESET_TIMEOUT_MS = 60_000;

beforeEach(async () => {
  fetchState.push(globalThis.fetch);
  // Re-checked here in case a test file repointed DATABASE_URL after setup.
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  await resetDatabase();
}, RESET_TIMEOUT_MS);

afterEach(() => {
  const previousFetch = fetchState.pop();
  globalThis.fetch = previousFetch ?? initialFetch;
});
