import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Migration file assertions ────────────────────────────────────────────────

describe("BENCHMARK_RUNNER → StakworkRun migration", () => {
  const enumMigrationPath = path.join(
    "prisma",
    "migrations",
    "20260820090000_add_benchmark_runner_run_type",
    "migration.sql",
  );
  const indexMigrationPath = path.join(
    "prisma",
    "migrations",
    "20260820090100_add_benchmark_runner_active_index",
    "migration.sql",
  );

  it("enum migration file exists", () => {
    expect(fs.existsSync(enumMigrationPath)).toBe(true);
  });

  it("adds BENCHMARK_RUNNER enum value", () => {
    const sql = fs.readFileSync(enumMigrationPath, "utf-8");
    expect(sql).toContain("ADD VALUE 'BENCHMARK_RUNNER'");
  });

  it("index migration file exists", () => {
    expect(fs.existsSync(indexMigrationPath)).toBe(true);
  });

  it("index migration creates partial index for active-run uniqueness guard", () => {
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    expect(sql).toContain("stakwork_runs_benchmark_active_run_idx");
    // Filtered to active statuses and the new type only
    expect(sql).toContain("WHERE status IN ('PENDING', 'IN_PROGRESS')");
    expect(sql).toContain("AND type = 'BENCHMARK_RUNNER'");
  });

  it("index migration does NOT include result::json expression (single-active-run guard uses findFirst, not index expression)", () => {
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    // Deliberately omits the JSON expression present on the legal benchmark index:
    // the BENCHMARK_RUNNER guard is a plain findFirst({ where: { workspaceId, type, status } })
    expect(sql).not.toContain("result::json");
  });

  it("schema contains BENCHMARK_RUNNER in StakworkRunType enum", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf-8");
    expect(schema).toContain("BENCHMARK_RUNNER");
  });
});
