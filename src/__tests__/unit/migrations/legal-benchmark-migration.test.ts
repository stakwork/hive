import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ─── Migration file assertions ────────────────────────────────────────────────

describe("Legal Benchmark → StakworkRun migration", () => {
  const enumMigrationPath = path.join(
    "prisma",
    "migrations",
    "20260706201200_add_legal_benchmark_run_types",
    "migration.sql",
  );
  const dropMigrationPath = path.join(
    "prisma",
    "migrations",
    "20260706201300_drop_legal_benchmark_run_table",
    "migration.sql",
  );

  it("enum migration file exists", () => {
    expect(fs.existsSync(enumMigrationPath)).toBe(true);
  });

  it("adds LEGAL_BENCHMARK_RUNNER enum value", () => {
    const sql = fs.readFileSync(enumMigrationPath, "utf-8");
    expect(sql).toContain("ADD VALUE 'LEGAL_BENCHMARK_RUNNER'");
  });

  it("adds LEGAL_BENCHMARK_SCORER enum value", () => {
    const sql = fs.readFileSync(enumMigrationPath, "utf-8");
    expect(sql).toContain("ADD VALUE 'LEGAL_BENCHMARK_SCORER'");
  });

  it("drop migration file exists", () => {
    expect(fs.existsSync(dropMigrationPath)).toBe(true);
  });

  it("drop migration drops LegalBenchmarkRun table", () => {
    const sql = fs.readFileSync(dropMigrationPath, "utf-8");
    expect(sql).toContain('DROP TABLE "LegalBenchmarkRun"');
  });

  it("drop migration includes safety guard against non-empty table", () => {
    const sql = fs.readFileSync(dropMigrationPath, "utf-8");
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain("RAISE EXCEPTION");
  });

  it("drop migration creates partial expression index for active-run uniqueness guard", () => {
    const sql = fs.readFileSync(dropMigrationPath, "utf-8");
    expect(sql).toContain("stakwork_runs_legal_benchmark_active_run_idx");
    // Partial expression index on the JSON result column's taskSlug field
    expect(sql).toContain("result::json->>'taskSlug'");
    // Filtered to active statuses only
    expect(sql).toContain("WHERE status IN ('PENDING', 'IN_PROGRESS')");
    expect(sql).toContain("AND type = 'LEGAL_BENCHMARK_RUNNER'");
  });

  it("schema no longer contains LegalBenchmarkRun model", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf-8");
    expect(schema).not.toContain("model LegalBenchmarkRun");
    expect(schema).not.toContain('"LegalBenchmarkRun"');
  });

  it("schema contains LEGAL_BENCHMARK_RUNNER in StakworkRunType enum", () => {
    const schema = fs.readFileSync(path.join("prisma", "schema.prisma"), "utf-8");
    expect(schema).toContain("LEGAL_BENCHMARK_RUNNER");
    expect(schema).toContain("LEGAL_BENCHMARK_SCORER");
  });
});

// ─── Codebase orphan check ────────────────────────────────────────────────────

describe("No orphaned legalBenchmarkRun references in src/ (outside migrating files)", () => {
  /**
   * Files that legitimately still reference legalBenchmarkRun / LegalBenchmarkRun
   * because they are owned by downstream tickets (T2, T3, T4) and will be
   * updated there. This list must shrink to zero once the full migration lands.
   */
  /**
   * T4 is now complete — frontend files no longer reference legacy identifiers.
   * Only the API route files (run + runId), service, webhook, and their tests
   * legitimately contain LEGAL_BENCHMARK_* references as part of the migrated impl.
   */
  const ALLOWED_FILES = new Set([
    "src/__tests__/unit/api/legal-benchmark.test.ts",
    "src/__tests__/unit/api/legal-benchmark-webhook.test.ts",
    "src/app/api/workspaces/[slug]/legal/benchmarks/run/route.ts",
    "src/app/api/workspaces/[slug]/legal/benchmarks/runs/[runId]/route.ts",
    "src/app/api/webhook/stakwork/response/route.ts",
    "src/services/stakwork-run.ts",
    "src/types/legal.ts",
  ]);

  it("only allowed files (pending downstream tickets) reference legalBenchmarkRun or LegalBenchmarkRun", () => {
    let output: string;
    try {
      // rg exits non-zero if no matches found; we want to handle both cases
      output = execSync(
        'rg -rl "legalBenchmarkRun|LegalBenchmarkRun|LEGAL_BENCHMARK" src/ --type ts --type tsx 2>/dev/null || true',
        { encoding: "utf-8", cwd: path.resolve(".") },
      );
    } catch {
      output = "";
    }

    const matchingFiles = output
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    const unexpectedFiles = matchingFiles.filter((f) => !ALLOWED_FILES.has(f));

    expect(unexpectedFiles).toEqual([]);
  });

  it("database.ts test utility no longer calls db.legalBenchmarkRun.deleteMany()", () => {
    const dbUtilPath = "src/__tests__/support/utilities/database.ts";
    if (!fs.existsSync(dbUtilPath)) return;
    const content = fs.readFileSync(dbUtilPath, "utf-8");
    expect(content).not.toContain("legalBenchmarkRun.deleteMany");
  });
});
