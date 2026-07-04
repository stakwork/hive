-- AlterTable
ALTER TABLE "error_issues" ADD COLUMN     "correlated_commit_sha" TEXT,
ADD COLUMN     "correlated_pr_number" INTEGER,
ADD COLUMN     "correlated_pr_url" TEXT,
ADD COLUMN     "correlation_candidates" JSONB,
ADD COLUMN     "correlation_computed_at" TIMESTAMP(3),
ADD COLUMN     "correlation_confidence" TEXT;
