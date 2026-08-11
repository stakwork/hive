-- AlterTable
ALTER TABLE "stakwork_runs" ADD COLUMN     "report_bundle" JSONB,
ADD COLUMN     "report_bundle_hash" TEXT,
ADD COLUMN     "report_partial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "report_rejection_reason" TEXT,
ADD COLUMN     "report_schema_unsupported" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "report_url" TEXT;
