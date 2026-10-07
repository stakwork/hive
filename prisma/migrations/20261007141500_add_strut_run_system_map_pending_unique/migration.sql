-- Atomic single-flight claim for System Map workflow runs: at most one
-- PENDING `StrutRun` per (workspace, kind) across the System Map kinds.
-- Prisma has no partial-unique-index primitive, so this lives only in SQL
-- (see the `StrutRun` model comment in schema.prisma). The route's launch
-- path relies on this via the P2002 it raises on the `create()` already in
-- `dispatchStrutRun` — no separate claim table, no check-then-create race.
--
-- The kind list is hardcoded on purpose (mirrors `SYSTEM_MAP_KINDS` in
-- `src/services/strut-runs/system-map.ts`): a new System Map kind needs a
-- follow-up migration to add it here.
CREATE UNIQUE INDEX IF NOT EXISTS "strut_runs_system_map_pending_unique_idx"
  ON "strut_runs" ("workspace_id", "kind")
  WHERE "status" = 'PENDING'
    AND "kind" IN ('system_map', 'system_map_materialize', 'system_map_cwe_check');
