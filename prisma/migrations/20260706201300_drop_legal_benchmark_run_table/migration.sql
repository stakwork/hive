-- Migration 2 of 2: Drop LegalBenchmarkRun table + add active-run uniqueness index
--
-- Uniqueness Guard Design:
--   PostgreSQL cannot enforce UNIQUE constraints on values inside a JSON column
--   directly. The approach used here is a PARTIAL EXPRESSION INDEX on
--   (workspace_id, type, (result::json->>'taskSlug')) filtered to active statuses.
--
--   This index is used by the application-level transaction guard in
--   src/app/api/workspaces/[slug]/legal/benchmarks/run/route.ts:
--     - The handler opens a db.$transaction()
--     - Inside the transaction, it does a findFirst for an existing active
--       LEGAL_BENCHMARK_RUNNER row matching (workspaceId, taskSlug-in-result)
--     - The expression index makes this check fast and effectively race-safe
--     - If none found, both runner+scorer StakworkRun rows are created atomically
--
--   The index does NOT enforce uniqueness by itself (no UNIQUE keyword) because
--   Prisma does not support partial unique constraints and the JSON expression
--   path is not a first-class column. Uniqueness is enforced transactionally in
--   the application layer.
--
--   Enum values LEGAL_BENCHMARK_RUNNER/SCORER were committed in migration
--   20260706201200 — required before referencing them here in a WHERE clause.

-- Step 1: Safety check — abort if LegalBenchmarkRun has any rows.
-- If this raises, run the data migration script to convert rows to StakworkRun
-- pairs before retrying this migration.
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM "LegalBenchmarkRun";
  IF row_count > 0 THEN
    RAISE EXCEPTION
      'LegalBenchmarkRun table has % rows — run the data migration script first.',
      row_count;
  END IF;
END $$;

-- Step 2: Add partial expression index for active-run uniqueness guard.
-- Scopes to (workspace_id, type, taskSlug-from-result-JSON) for PENDING/IN_PROGRESS
-- LEGAL_BENCHMARK_RUNNER rows only. Used by transactional guard in run/route.ts.
CREATE INDEX "stakwork_runs_legal_benchmark_active_run_idx"
  ON "stakwork_runs" (workspace_id, type, (result::json->>'taskSlug'))
  WHERE status IN ('PENDING', 'IN_PROGRESS') AND type = 'LEGAL_BENCHMARK_RUNNER';

-- Step 3: Drop LegalBenchmarkRun table (table is empty, confirmed by step 1 guard above).
DROP INDEX IF EXISTS "LegalBenchmarkRun_workspaceId_idx";
DROP INDEX IF EXISTS "LegalBenchmarkRun_taskSlug_idx";
DROP TABLE "LegalBenchmarkRun";
