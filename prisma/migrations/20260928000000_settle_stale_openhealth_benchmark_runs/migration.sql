-- Data-only migration: no schema change.
--
-- OpenHealth Benchmarks now reads/writes exclusively through the
-- `openhealth-run` / `openhealth-list-tasks` strut on the hive workspace's
-- own swarm (see src/app/api/workspaces/[slug]/openhealth/benchmarks/**).
-- Hive no longer creates StakworkRun rows for this feature, and the webhook
-- that used to settle them is retired (processStakworkRunWebhook now
-- refuses OPENHEALTH_BENCHMARK_RUNNER webhooks outright).
--
-- Any OPENHEALTH_BENCHMARK_RUNNER row still PENDING/IN_PROGRESS at this
-- point can never be settled by anything going forward — there is no
-- poll-on-read, no cron, and no webhook path left for it. Mark every such
-- row FAILED so none stays unsettled or writable. The
-- OPENHEALTH_BENCHMARK_RUNNER enum value itself is NOT removed — old rows
-- (now FAILED) still need it to deserialize.
UPDATE "stakwork_runs"
SET "status" = 'FAILED', "updated_at" = now()
WHERE "type" = 'OPENHEALTH_BENCHMARK_RUNNER'
  AND "status" IN ('PENDING', 'IN_PROGRESS');
