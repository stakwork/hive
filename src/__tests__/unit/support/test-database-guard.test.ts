import { describe, it, expect } from "vitest";
import {
  assertTestDatabaseUrl,
  getDatabaseName,
  isTestDatabaseUrl,
} from "@/__tests__/support/utilities/test-database-guard";

describe("isTestDatabaseUrl", () => {
  it.each([
    "postgresql://test:test@localhost:5433/hive_test",
    "postgresql://hive_user:hive_password@localhost:5432/hive_test",
    "postgresql://localhost:5432/hive_test_unit",
    "postgres://u:p@db:5432/TEST_hive?schema=public",
  ])("allows %s", (url) => {
    expect(isTestDatabaseUrl(url)).toBe(true);
  });

  it.each([
    ["dev database", "postgresql://hive_user:hive_password@localhost:5432/hive_db"],
    ["test only in the user", "postgresql://test:test@localhost:5432/hive_db"],
    ["test only in the host", "postgresql://u:p@test-host:5432/hive_db"],
    ["test only in the query", "postgresql://u:p@localhost:5432/hive_db?schema=test"],
    ["no database name", "postgresql://u:p@localhost:5432"],
    ["not a URL", "hive_test"],
    ["empty", ""],
    ["undefined", undefined],
  ])("refuses %s", (_label, url) => {
    expect(isTestDatabaseUrl(url)).toBe(false);
  });
});

describe("getDatabaseName", () => {
  it("reads the path and ignores query params", () => {
    expect(getDatabaseName("postgresql://u:p@h:5432/hive_test?schema=public")).toBe("hive_test");
  });
});

describe("assertTestDatabaseUrl", () => {
  it("passes a test database", () => {
    expect(() => assertTestDatabaseUrl("postgresql://test:test@localhost:5433/hive_test")).not.toThrow();
  });

  it("throws for the dev database and says how to use the Docker test DB", () => {
    expect(() => assertTestDatabaseUrl("postgresql://localhost:5432/hive_db")).toThrow(
      /"hive_db".*\n[\s\S]*npm run test:db:start[\s\S]*TEST_DATABASE_URL=postgresql:\/\/test:test@localhost:5433\/hive_test/,
    );
  });
});
