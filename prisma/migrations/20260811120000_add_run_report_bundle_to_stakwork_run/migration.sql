-- AlterTable (idempotent: additive columns, safe to re-run)
-- Idempotency guards match the established pattern in this repo — two earlier
-- migrations were patched to add them after re-run failures.
ALTER TABLE "stakwork_runs" ADD COLUMN IF NOT EXISTS "report_bundle" JSONB,
ADD COLUMN IF NOT EXISTS "report_bundle_hash" TEXT,
ADD COLUMN IF NOT EXISTS "report_partial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "report_rejection_reason" TEXT,
ADD COLUMN IF NOT EXISTS "report_schema_unsupported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "report_url" TEXT;
