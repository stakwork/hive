-- Hand-written migration — Prisma cannot express a partial-index WHERE
-- predicate in schema.prisma, so this is not (and must never be) generated
-- by `prisma migrate dev`.
--
-- Purpose: the atomic single-active-run guard for the Protect "System Map"
-- schema-sync feature. Only ONE `strut_runs` row may be PENDING per
-- (workspace_id, kind) for kind = 'system_map_schema_sync' at a time — a
-- concurrent second `dispatchStrutRun` insert for the same workspace hits
-- this unique index and Postgres raises a unique-violation (P2002), which
-- the API route (`protect/system-map/route.ts`) catches and turns into a
-- 409 "a sync is already running" response. Terminal rows (SUCCESS, ERROR,
-- CANCELLED, LOST) are excluded by the predicate, so they never collide.
--
-- Named on "strut_runs" (the @@map table name), NOT "StrutRun" (the Prisma
-- model name) — using the model name has broken CI before on a sibling
-- partial index and must not be repeated.
--
-- Apply:   npx prisma migrate deploy   (or `migrate dev` picks it up as an
--          already-applied file once committed — do NOT regenerate it).
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS "strut_runs_system_map_pending_active_idx";
--          (safe to drop any time; it only enforces a concurrency guard,
--          it carries no data.)
CREATE UNIQUE INDEX IF NOT EXISTS "strut_runs_system_map_pending_active_idx"
ON "strut_runs" (workspace_id, kind)
WHERE status = 'PENDING' AND kind = 'system_map_schema_sync';

-- CreateIndex
-- Ordinary (non-partial) index backing the GET route's
-- `{ activeRun, latestTerminalRun }` lookups, scoped by workspace + kind.
CREATE INDEX IF NOT EXISTS "strut_runs_workspace_id_kind_status_idx"
ON "strut_runs" (workspace_id, kind, status);
