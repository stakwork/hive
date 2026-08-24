import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ─── Migration file assertions ────────────────────────────────────────────────

describe("BENCHMARK_RUNNER → StakworkRun migration", () => {
  const enumMigrationPath = path.join(
    "prisma",
    "migrations",
    "20260821001000_add_benchmark_runner_run_type",
    "migration.sql",
  );
  const indexMigrationPath = path.join(
    "prisma",
    "migrations",
    "20260821002000_add_benchmark_runner_active_index",
    "migration.sql",
  );

  // ── Migration A: enum value ──────────────────────────────────────────────

  it("enum migration file exists", () => {
    expect(fs.existsSync(enumMigrationPath)).toBe(true);
  });

  it("adds BENCHMARK_RUNNER enum value", () => {
    const sql = fs.readFileSync(enumMigrationPath, "utf-8");
    expect(sql).toContain("ADD VALUE 'BENCHMARK_RUNNER'");
  });

  it("does NOT add WORKFLOW_BENCHMARK_RUNNER (old closed-PR name)", () => {
    const sql = fs.readFileSync(enumMigrationPath, "utf-8");
    expect(sql).not.toContain("WORKFLOW_BENCHMARK_RUNNER");
  });

  // ── Migration B: partial index ────────────────────────────────────────────

  it("index migration file exists", () => {
    expect(fs.existsSync(indexMigrationPath)).toBe(true);
  });

  it("creates index ON \"stakwork_runs\" (the @@map table), not \"StakworkRun\" (the Prisma model name)", () => {
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    // Table name must be the @@map'd name, never the Prisma model name.
    // This exact mistake already broke CI on the sibling legal index.
    expect(sql).toContain('ON "stakwork_runs"');
    // Check the DDL line specifically (not a comment mentioning the wrong name as a warning)
    const ddlLine = sql.split("\n").find((l) => l.trim().startsWith("ON "));
    expect(ddlLine).toBeDefined();
    expect(ddlLine).toContain('"stakwork_runs"');
    expect(ddlLine).not.toContain('"StakworkRun"');
  });

  it("index is named stakwork_runs_benchmark_active_run_idx", () => {
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    expect(sql).toContain("stakwork_runs_benchmark_active_run_idx");
    // Also verify the old closed-PR index name is absent
    expect(sql).not.toContain("stakwork_runs_workflow_benchmark_active_run_idx");
  });

  it("partial index filters on PENDING and IN_PROGRESS statuses", () => {
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    expect(sql).toContain("WHERE status IN ('PENDING', 'IN_PROGRESS')");
  });

  it("partial index filters on BENCHMARK_RUNNER type", () => {
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    expect(sql).toContain("AND type = 'BENCHMARK_RUNNER'");
  });

  it("index predicate shape matches the single-active-run findFirst query", () => {
    // The dispatch guard issues findFirst({ where: { workspaceId, type, status: { in: [PENDING, IN_PROGRESS] } } })
    // The index must cover exactly those columns to be useful.
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    expect(sql).toContain("workspace_id");
    expect(sql).toContain("type");
    expect(sql).toContain("status");
  });

  it("does NOT include a JSON expression column (result::json->>'taskSlug') in the DDL", () => {
    // The legal index includes a JSON expression but the guard doesn't query it.
    // Adding one here would be dead index weight — assert it's absent from the DDL.
    const sql = fs.readFileSync(indexMigrationPath, "utf-8");
    // Check only the non-comment DDL lines (comments explain what NOT to do)
    const ddlLines = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(ddlLines).not.toContain("result::json");
    expect(ddlLines).not.toContain("taskSlug");
  });

  // ── Schema assertions ─────────────────────────────────────────────────────

  it("schema contains BENCHMARK_RUNNER in StakworkRunType enum", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf-8");
    expect(schema).toContain("BENCHMARK_RUNNER");
  });

  it("schema still contains LEGAL_BENCHMARK_RUNNER as a SEPARATE distinct value", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf-8");
    // Both must coexist — BENCHMARK_RUNNER is NOT an alias for legal runs
    expect(schema).toContain("LEGAL_BENCHMARK_RUNNER");
    expect(schema).toContain("BENCHMARK_RUNNER");
  });

  it("schema does NOT contain WORKFLOW_BENCHMARK_RUNNER (old closed-PR name)", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf-8");
    expect(schema).not.toContain("WORKFLOW_BENCHMARK_RUNNER");
  });
});
