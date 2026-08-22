-- CreateIndex
-- Partial index for the BENCHMARK_RUNNER single-active-run guard.
--
-- Index shape matches the findFirst({ where: { workspaceId, type, status } })
-- query in the dispatch route. Does NOT include a (result::json->>'taskSlug')
-- expression column — that guard is applied in application code after fetching,
-- so the JSON expression would be index weight for a query shape nobody issues.
--
-- Named ON "stakwork_runs" (the @@map table name), NOT "StakworkRun" (the
-- Prisma model name) — using the model name already broke CI once on the
-- sibling legal index and must not be repeated.
--
-- StakworkRun has no @@unique constraint; uniqueness is APP-LEVEL ONLY.
CREATE INDEX IF NOT EXISTS "stakwork_runs_benchmark_active_run_idx"
ON "stakwork_runs" (workspace_id, type, status)
WHERE status IN ('PENDING', 'IN_PROGRESS') AND type = 'BENCHMARK_RUNNER';
