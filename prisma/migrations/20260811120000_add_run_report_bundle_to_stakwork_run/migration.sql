-- AlterTable (idempotent: additive column, safe to re-run)
-- Idempotency guard matches the established pattern in this repo — two earlier
-- migrations were patched to add them after re-run failures.
ALTER TABLE "stakwork_runs" ADD COLUMN IF NOT EXISTS "report_url" TEXT;
