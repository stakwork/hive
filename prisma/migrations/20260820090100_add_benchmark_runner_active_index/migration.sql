-- Partial index to support the single-active-run guard for BENCHMARK_RUNNER.
-- The uniqueness constraint is enforced at the application level via a findFirst()
-- query; this index makes that lookup efficient without any @@unique on StakworkRun
-- (StakworkRun has no @@unique — uniqueness is app-level only, matching the precedent
-- set by the legal benchmark migrations 20260706201200/20260706201300).
--
-- Deliberately omits the JSON expression column present on the legal benchmark index
-- (which uses a cast of the result column to extract taskSlug):
-- the BENCHMARK_RUNNER single-active-run guard is a plain
-- findFirst({ where: { workspaceId, type, status } }) that parses result in application
-- code. The JSON expression would index weight for a query nobody issues.
CREATE INDEX "stakwork_runs_benchmark_active_run_idx"
  ON "stakwork_runs" (workspace_id, type, status)
  WHERE status IN ('PENDING', 'IN_PROGRESS')
  AND type = 'BENCHMARK_RUNNER';
