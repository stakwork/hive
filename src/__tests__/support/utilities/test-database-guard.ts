/**
 * Guard that keeps integration tests off non-test databases.
 *
 * Integration tests call resetDatabase() before every test, which deletes every
 * row in every table. Pointing them at a dev database wipes it, so the target's
 * database name (the URL path, not the host or credentials) must contain "test".
 */

const DOCKER_TEST_DATABASE_URL = "postgresql://test:test@localhost:5433/hive_test";

export function getDatabaseName(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
}

export function isTestDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  const name = getDatabaseName(url);
  return name !== null && name.toLowerCase().includes("test");
}

export function assertTestDatabaseUrl(url: string | undefined): asserts url is string {
  if (isTestDatabaseUrl(url)) return;
  const name = url ? getDatabaseName(url) : null;
  throw new Error(
    [
      `Refusing to run integration tests against database "${name ?? "(none)"}": its name does not contain "test".`,
      "Integration tests delete every row in every table before each test.",
      "Point them at the Docker test database instead:",
      "  npm run test:db:start && npm run test:db:setup",
      `  TEST_DATABASE_URL=${DOCKER_TEST_DATABASE_URL} npm run test:integration`,
      "See docs/TEST_DATABASE.md.",
    ].join("\n"),
  );
}
